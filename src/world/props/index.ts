import { commonProps, type PropFn } from './common';
import { japanProps } from './japan';

export const PROP_FNS: Record<string, PropFn> = {
  ...commonProps,
  ...japanProps,
};

export function registerProps(fns: Record<string, PropFn>): void {
  Object.assign(PROP_FNS, fns);
}
