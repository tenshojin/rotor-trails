import { commonProps, type PropFn } from './common';
import { japanProps } from './japan';
import { canyonProps } from './canyon';
import { amazonProps } from './amazon';

export const PROP_FNS: Record<string, PropFn> = {
  ...commonProps,
  ...japanProps,
  ...canyonProps,
  ...amazonProps,
};

export function registerProps(fns: Record<string, PropFn>): void {
  Object.assign(PROP_FNS, fns);
}
