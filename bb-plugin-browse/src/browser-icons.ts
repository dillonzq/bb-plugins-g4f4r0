import { ArrowLeft01Icon, ArrowRight01Icon, ArrowReloadHorizontalIcon, MoreHorizontalIcon, Menu01Icon, Globe02Icon, ComputerTerminal01Icon } from '@hugeicons/core-free-icons';
export const browserIcons = { ArrowLeft: ArrowLeft01Icon, ArrowRight: ArrowRight01Icon, RefreshCw: ArrowReloadHorizontalIcon, More: MoreHorizontalIcon, List: Menu01Icon, Globe: Globe02Icon, Terminal: ComputerTerminal01Icon };
export type BrowserIconName = keyof typeof browserIcons;
// Only trusted icon-package data is serialized; no page or session strings.
export function browserIconSvg(name: BrowserIconName) {
  const nodes = browserIcons[name].map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).filter(([key]) => key !== 'key').map(([key, value]) => `${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ')} />`).join('');
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-icon-library="hugeicons">${nodes}</svg>`;
}
