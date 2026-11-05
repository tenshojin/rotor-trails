import { commonProps, type PropFn } from './common';
import { japanProps } from './japan';
import { canyonProps } from './canyon';
import { amazonProps } from './amazon';
import { fjordProps } from './fjord';
import { himalayaProps } from './himalaya';
import { trainingProps } from './training';

export const PROP_FNS: Record<string, PropFn> = {
  ...commonProps,
  ...japanProps,
  ...canyonProps,
  ...amazonProps,
  ...fjordProps,
  ...himalayaProps,
  ...trainingProps,
};

export function registerProps(fns: Record<string, PropFn>): void {
  Object.assign(PROP_FNS, fns);
}
