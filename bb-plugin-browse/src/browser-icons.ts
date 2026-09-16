import { ArrowUpRight01Icon, Loading03Icon, Tick02Icon, LaptopIcon, Copy01Icon, ArrowLeft01Icon, ArrowRight01Icon, ArrowReloadHorizontalIcon, MoreHorizontalIcon, Menu01Icon, Globe02Icon, ComputerTerminal01Icon, Cursor02Icon, SmartPhone01Icon, RotateClockwiseIcon } from '@hugeicons/core-free-icons';
export const browserIcons = { External: ArrowUpRight01Icon, Loading: Loading03Icon, Check: Tick02Icon, Machine: LaptopIcon, Copy: Copy01Icon, ArrowLeft: ArrowLeft01Icon, ArrowRight: ArrowRight01Icon, RefreshCw: ArrowReloadHorizontalIcon, More: MoreHorizontalIcon, List: Menu01Icon, Globe: Globe02Icon, Terminal: ComputerTerminal01Icon, Cursor: Cursor02Icon, Responsive: SmartPhone01Icon, Rotate: RotateClockwiseIcon };
export type BrowserIconName = keyof typeof browserIcons;
// Only trusted icon-package data is serialized; no page or session strings.
export function browserIconSvg(name: BrowserIconName) {
  const nodes = browserIcons[name].map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).filter(([key]) => key !== 'key').map(([key, value]) => `${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ')} />`).join('');
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-icon-library="hugeicons">${nodes}</svg>`;
}
