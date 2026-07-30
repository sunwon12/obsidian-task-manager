// LLD §3.2: 시각 헬퍼.
import type { IsoDateTime, IsoDate } from "./types";

export function nowIso(): IsoDateTime {
  return new Date().toISOString() as IsoDateTime;
}

export function isoDate(d: Date = new Date()): IsoDate {
  return d.toISOString().slice(0, 10) as IsoDate;
}

/** 두 ISO datetime 중 더 최근을 반환. 동률이면 a를 반환. */
export function laterOf(a: IsoDateTime, b: IsoDateTime): IsoDateTime {
  return a >= b ? a : b;
}
