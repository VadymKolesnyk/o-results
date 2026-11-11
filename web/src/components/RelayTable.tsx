import { fmtGap, fmtPts } from '../lib/results'
import { isExtra, respClass, screenColumns } from '../lib/columns'
import { DEFAULT_DISPLAY_CONFIG, STATUS_ORDER } from '../types'
import type { ColumnConfig, DisplayConfig, GroupRow, RelayLeg, RelayTeamRow } from '../types'

const MEDAL = ['', 'gold', 'silver', 'bronze']

interface Props {
  teams: RelayTeamRow[]
  groups: GroupRow[]
  activeGrp: string
  query: string
  showPts: boolean
  cfg: DisplayConfig | null
  showAll: boolean // «Всі колонки» (малий екран): показати й приховані
}

// Порядок команд (як у протоколі й на моніторі OrientPyx): фініш (за місцем) →
// без місця (за часом) → на дистанції (більше етапів 1…k пройдено поспіль — вище,
// далі за наростаючим часом після етапу k) → зняті → не старт; за рівних — за
// номером команди.
function cmpTeams(a: RelayTeamRow, b: RelayTeamRow): number {
  const sa = STATUS_ORDER[a.status] ?? 9
  const sb = STATUS_ORDER[b.status] ?? 9
  if (sa !== sb) return sa - sb
  if (a.status === 'finished' && a.rk && b.rk && a.rk !== b.rk) return a.rk - b.rk
  if (a.status === 'running') {
    const pa = legsDone(a)
    const pb = legsDone(b)
    if (pa.legs !== pb.legs) return pb.legs - pa.legs
    if (pa.legs > 0 && pa.seconds !== pb.seconds) return pa.seconds - pb.seconds
  }
  if (a.status === 'finished' || a.status === 'finished_pending' || a.status === 'dsq') {
    const ta = a.result_seconds ?? 1e9
    const tb = b.result_seconds ?? 1e9
    if (ta !== tb) return ta - tb
  }
  return a.num - b.num
}

// Скільки етапів від першого фінішували поспіль (OK, є наростаючий час) і
// наростаючий час команди після останнього з них, у секундах.
function legsDone(t: RelayTeamRow): { legs: number; seconds: number } {
  let legs = 0
  let seconds = 0
  for (const l of [...(t.legs || [])].sort((x, y) => x.leg - y.leg)) {
    if (l.status !== 'finished' || !l.cumulative) break
    legs++
    seconds = hmsToSeconds(l.cumulative)
  }
  return { legs, seconds }
}

// «hh:mm:ss» → секунди.
function hmsToSeconds(s: string): number {
  return s.split(':').reduce((acc, part) => acc * 60 + (Number(part) || 0), 0)
}

// Пошук: номер / назва / клуб / регіон команди, або ПІБ / номер будь-якого етапу.
function matchesTeam(t: RelayTeamRow, q: string): boolean {
  if (!q) return true
  const hit = (s: string | null | undefined) => (s || '').toLowerCase().includes(q)
  return (
    String(t.num).includes(q) ||
    hit(t.name) ||
    hit(t.club) ||
    hit(t.region) ||
    (t.legs || []).some((l) => hit(l.full_name) || l.bib.includes(q))
  )
}

// Текст статусу нефінішера — спільний для команди й етапу.
function statusText(status: string, reason: string | null): React.ReactNode {
  if (status === 'pending') return <span className="b-running">очікує</span>
  if (status === 'running') return <span className="b-running">на дистанції</span>
  if (status === 'dsq') return <span className="flag">{reason || 'зн.'}</span>
  if (status === 'dns')
    return (
      <span className="b-running" style={{ color: '#9aa2b8' }}>
        не старт.
      </span>
    )
  return ''
}

// Колонка «Результат»: час (жирним — залік команди) і, де немає окремої колонки
// «Статус», текст статусу поряд (statusCls ховає його там, де вона є).
function resultCell(
  time: string | null | undefined,
  status: string,
  reason: string | null,
  bold: boolean,
  pendingNote: boolean,
  statusCls: string,
): React.ReactNode {
  if (status === 'finished' || status === 'finished_pending')
    return (
      <>
        <span className={bold ? 'time' : 'time-plain'}>{time || ''}</span>
        {pendingNote && (
          <>
            {' '}
            <span className="b-running" style={{ fontSize: 11 }}>
              (обробка)
            </span>
          </>
        )}
      </>
    )
  return (
    <>
      {time && <span className="time-plain">{time} </span>}
      <span className={statusCls}>{statusText(status, reason)}</span>
    </>
  )
}

// Зарахований час етапу (зважена естафета: T·K); старіший OrientPyx шле лише
// leg_time — для звичайної естафети це той самий час.
const legResult = (l: RelayLeg) => l.result_time ?? l.leg_time

// Підписи колонок плагіна поряд зі значеннями етапу: «K 0.95 · T·K 23:45» — лише
// для даних від старішого OrientPyx, у чийому конфігу додаткових колонок немає.
function legExtras(l: RelayLeg, columns: RelayTeamRow['columns']): string {
  if (!columns?.length || !l.extra) return ''
  return columns
    .map((c) => (l.extra?.[c.key] ? `${c.label} ${l.extra[c.key]}` : ''))
    .filter(Boolean)
    .join(' · ')
}

interface Ctx {
  t: RelayTeamRow
  gap: string
  statusCls: string // ховає статус у «Результаті», де є окрема колонка
  legacyExtras: boolean // колонки плагіна рядком під ПІБ (старіший OrientPyx)
}

// Колонка естафети: заголовок і клітинки рядка команди та рядка етапу. Ключі ті
// самі, що в особистих результатах (display_config): команда заповнює командні
// колонки (місце, назва, результат, відставання, бали), етап — бігуна (ПІБ,
// розряд, клуб, старт, результат етапу, наростаючий) і додаткові колонки.
interface RelayColMeta {
  header: { full: string; short?: string }
  cls?: string
  team: (x: Ctx) => React.ReactNode
  leg: (l: RelayLeg, x: Ctx) => React.ReactNode
}

const none = () => ''

const COLS: Record<string, RelayColMeta> = {
  rk: {
    header: { full: 'Місце', short: 'М' },
    cls: 'rk',
    team: ({ t }) =>
      t.out_of_competition ? (
        <span className="oc">П/К</span>
      ) : t.status === 'finished' && t.rk ? (
        <span className={MEDAL[t.rk] || ''}>{t.rk}</span>
      ) : (
        ''
      ),
    leg: none,
  },
  full_name: {
    header: { full: 'Команда / етап' },
    team: ({ t }) => (
      <>
        <span className="team-name">{t.name || `Команда ${t.num}`}</span>
        {t.restarted && <span className="tag">з перезапуском</span>}
      </>
    ),
    leg: (l, { t, legacyExtras }) => {
      const extras = legacyExtras ? legExtras(l, t.columns) : ''
      return (
        <>
          {l.full_name ? (
            <span>{l.full_name}</span>
          ) : (
            <span className="vacant">етап {l.leg} — без учасника</span>
          )}
          {l.course && <span className="tag">дистанція {l.course}</span>}
          {l.restarted && <span className="tag">перезапуск</span>}
          {extras && <div className="leg-extra">{extras}</div>}
        </>
      )
    },
  },
  bib: {
    header: { full: '№' },
    team: ({ t }) => t.num,
    leg: (l) => <span className="leg-bib">{l.bib}</span>,
  },
  birth: { header: { full: 'Рік нар.' }, team: none, leg: (l) => l.birth || '' },
  qual: { header: { full: 'Розряд' }, team: none, leg: (l) => l.qual || '' },
  club: { header: { full: 'Клуб' }, team: ({ t }) => t.club || '', leg: (l) => l.club || '' },
  region: { header: { full: 'Регіон' }, team: ({ t }) => t.region || '', leg: (l) => l.region || '' },
  start_time: {
    header: { full: 'Старт' },
    team: none,
    leg: (l) => <span className="time-plain">{l.start_time || ''}</span>,
  },
  result_time: {
    header: { full: 'Результат', short: 'Рез.' },
    team: ({ t, statusCls }) =>
      resultCell(
        t.result_time,
        t.status,
        t.reason,
        true,
        t.status === 'finished_pending' && !t.out_of_competition,
        statusCls,
      ),
    leg: (l, { statusCls }) => resultCell(legResult(l), l.status, l.reason, false, false, statusCls),
  },
  gap: {
    header: { full: 'Відставання', short: 'Відст.' },
    cls: 'time',
    team: ({ gap }) => gap && <span className="time">{gap}</span>,
    leg: none,
  },
  cumulative: {
    header: { full: 'Наростаючий', short: 'Σ' },
    team: none,
    leg: (l) => l.cumulative && <span className="time-plain">{l.cumulative}</span>,
  },
  status: {
    header: { full: 'Статус' },
    team: ({ t }) => statusText(t.status, t.reason),
    leg: (l) => statusText(l.status, l.reason),
  },
  points: {
    header: { full: 'Бали' },
    cls: 'pts',
    team: ({ t }) => (t.points != null ? fmtPts(t.points) : ''),
    leg: none,
  },
}

// Додаткова колонка (плагіна / додаткового поля): значення етапу з legs[].extra.
function extraMeta(c: ColumnConfig): RelayColMeta {
  return { header: { full: c.label || c.key }, team: none, leg: (l) => l.extra?.[c.key] || '' }
}

type Col = ColumnConfig & { m: RelayColMeta }

export function RelayTable({ teams, groups, activeGrp, query, showPts, cfg, showAll }: Props) {
  const q = query.trim().toLowerCase()
  const list = (q ? teams.filter((t) => matchesTeam(t, q)) : [...teams]).sort(cmpTeams)

  if (!list.length)
    return (
      <div className="empty">
        <div className="empty-title">Нічого не знайдено</div>
        <div className="empty-sub">За запитом «{query.trim()}» немає команд</div>
      </div>
    )

  // Найкращий час команди з місцем — для відставання.
  const winnerSec = list.reduce<number | null>((min, t) => {
    if (t.status !== 'finished' || t.rk == null || t.result_seconds == null) return min
    return min == null || t.result_seconds < min ? t.result_seconds : min
  }, null)
  const withPts = showPts && list.some((t) => t.points != null)

  const conf = cfg ?? DEFAULT_DISPLAY_CONFIG
  const separateLg = conf.separateDsqLg
  const separateSm = showAll ? separateLg : conf.separateDsqSm
  const legacyExtras = !conf.columns.some(isExtra)
  // Колонки — ті самі, що налаштовані для особистих результатів (порядок,
  // великий/малий екран). Додаткову колонку без жодного значення в групі не
  // показуємо (інший день / інший вид змагань).
  const cols = screenColumns(conf, showAll, separateLg, separateSm)
    .filter((c) => (c.key === 'points' ? withPts : true))
    .filter((c) => !isExtra(c) || list.some((t) => (t.legs || []).some((l) => l.extra?.[c.key])))
    .map((c) => ({ ...c, m: COLS[c.key] ?? (isExtra(c) ? extraMeta(c) : undefined) }))
    .filter((c): c is Col => !!c.m)
  const statusCls = `${separateLg ? 'hide-lg' : ''} ${separateSm ? 'hide-sm' : ''}`.trim()
  const cellCls = (c: Col) => `col-${c.key} ${c.m.cls ?? ''} ${respClass(c.lg, c.sm)}`.trim()

  const g = groups.find((x) => x.name === activeGrp)
  const legCount = Math.max(0, ...list.map((t) => t.legs?.length ?? 0))
  const fin = list.filter((t) => t.status === 'finished' || t.status === 'finished_pending').length
  const run = list.filter((t) => t.status === 'running').length
  const dsq = list.filter((t) => t.status === 'dsq').length

  return (
    <>
      <div className="ghead">
        <b>{activeGrp}</b>
        <>
          {' '}
          &nbsp;{' '}
          <span>
            естафета{legCount ? `, етапів: ${legCount}` : ''}
            {g?.controls ? <>&nbsp; {g.controls} КП</> : ''}
            {g?.distance_km ? <>&nbsp; {g.distance_km} км</> : ''}
          </span>
        </>
      </div>
      <div className={`tbl-scroll cfg-table${showAll ? ' show-all' : ''}`}>
        <table className="relay">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={cellCls(c)}>
                  {c.m.header.short ? (
                    <>
                      <span className="th-full">{c.m.header.full}</span>
                      <span className="th-short">{c.m.header.short}</span>
                    </>
                  ) : (
                    c.m.header.full
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {list.map((t) => {
            const gap =
              t.result_seconds != null && winnerSec != null && t.rk != null
                ? fmtGap(t.result_seconds - winnerSec)
                : ''
            const x: Ctx = { t, gap, statusCls, legacyExtras }
            return (
              <tbody key={t.num} className="relay-team">
                <tr className="team-row">
                  {cols.map((c) => (
                    <td key={c.key} className={cellCls(c)}>
                      {c.m.team(x)}
                    </td>
                  ))}
                </tr>
                {(t.legs || []).map((l) => (
                  <tr key={l.leg} className="leg-row">
                    {cols.map((c) => (
                      <td key={c.key} className={cellCls(c)}>
                        {c.m.leg(l, x)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        Фінішували: {fin} · на дистанції: {run}
        {dsq ? ` · знято: ${dsq}` : ''} · команд: {list.length}
      </p>
    </>
  )
}
