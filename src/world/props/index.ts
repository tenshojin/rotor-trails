import { commonProps, type PropFn } from './common';

export const PROP_FNS: Record<string, PropFn> = {
  ...commonProps,
};

export function registerProps(fns: Record<string, PropFn>): void {
  Object.assign(PROP_FNS, fns);
}
