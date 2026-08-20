import { contentLineBreak } from "../fold";
import type { IcsPatch, IcsPatchCoercion } from "../patch";

const absoluteDateTime = /^\d{8}T\d{6}Z$/u;
const floatingDateTime = /^\d{8}T\d{6}$/u;

const splitMixedExdate: IcsPatch = {
  properties: ["EXDATE"],
  coerce: (params: string, value: string): IcsPatchCoercion | null => {
    const values = value.split(",");
    const floating = values.filter((entry) => floatingDateTime.test(entry));
    const absolute = values.filter((entry) => absoluteDateTime.test(entry));
    if (floating.length === 0 || absolute.length === 0) {
      return null;
    }
    if (floating.length + absolute.length !== values.length) {
      return null;
    }
    return {
      params,
      value: `${floating.join(",")}${contentLineBreak}EXDATE${params}:${absolute.join(",")}`,
    };
  },
};

export { splitMixedExdate };
