// Спільне для таблиць, що беруть колонки з display_config (особисті результати
// й естафета): порядок, адаптивні класи, додаткові колонки OrientPyx.

import type { ColumnConfig, DisplayConfig } from '../types'

// Додаткова колонка OrientPyx (колонка плагіна чи додаткове поле учасника):
// лише вона має в конфігу власний підпис; значення — у results.extra /
// legs[].extra за key.
export function isExtra(c: ColumnConfig): boolean {
  return !!c.label
}

// Чи показує конфіг хоч одну додаткову колонку — лише тоді тягнемо
// results.extra (у проєкті, створеному до неї, цієї колонки може не бути).
export function wantsExtra(cfg: DisplayConfig | null | undefined): boolean {
  return !!cfg?.columns.some((c) => isExtra(c) && (c.lg || c.sm))
}

// Колонки конфігу за порядком. «Наростаючий» (cumulative), якого немає в конфігу
// старішого OrientPyx, стає одразу після «Відставання» (або «Результату») —
// видимим, як раніше в естафеті.
export function orderedColumns(cfg: DisplayConfig): ColumnConfig[] {
  const cols = [...cfg.columns].sort((a, b) => a.order - b.order)
  if (cols.some((c) => c.key === 'cumulative')) return cols
  const after = Math.max(
    cols.findIndex((c) => c.key === 'gap'),
    cols.findIndex((c) => c.key === 'result_time'),
  )
  const cum: ColumnConfig = { key: 'cumulative', order: 0, lg: true, sm: true }
  return after >= 0 ? [...cols.slice(0, after + 1), cum, ...cols.slice(after + 1)] : [...cols, cum]
}

// Видимість колонки для екрана: «Всі колонки» (малий екран) дублює великий;
// «Статус» — лише там, де ввімкнено розділення «Результат»/«Статус».
export function screenColumns(
  cfg: DisplayConfig,
  showAll: boolean,
  separateLg: boolean,
  separateSm: boolean,
): ColumnConfig[] {
  return orderedColumns(cfg)
    .map((c) => (showAll ? { ...c, sm: c.lg } : c))
    .map((c) =>
      c.key === 'status' ? { ...c, lg: c.lg && separateLg, sm: c.sm && separateSm } : c,
    )
    .filter((c) => c.lg || c.sm)
}

// Клас адаптивності: ховаємо колонку на тому екрані, де lg/sm = false.
export function respClass(lg: boolean, sm: boolean): string {
  const c: string[] = []
  if (!lg) c.push('hide-lg')
  if (!sm) c.push('hide-sm')
  return c.join(' ')
}
