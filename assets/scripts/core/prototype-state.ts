export const ITEM_IDS = ['fuel', 'food', 'medicine'] as const;

export type ItemId = (typeof ITEM_IDS)[number];

export interface PrototypeState {
  readonly version: 1;
  readonly trunkSlots: readonly (ItemId | null)[];
}

export const TRUNK_SLOT_COUNT = 3;

export function createInitialState(): PrototypeState {
  return {
    version: 1,
    trunkSlots: Array.from({ length: TRUNK_SLOT_COUNT }, () => null),
  };
}

export function placeItem(
  state: PrototypeState,
  item: ItemId,
  slotIndex: number,
): PrototypeState {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= TRUNK_SLOT_COUNT) {
    throw new RangeError(`Invalid trunk slot: ${slotIndex}`);
  }

  const trunkSlots = state.trunkSlots.map((current) => current === item ? null : current);
  trunkSlots[slotIndex] = item;

  return { version: 1, trunkSlots };
}

export function encodePrototypeState(state: PrototypeState): string {
  return JSON.stringify(state);
}

export function decodePrototypeState(raw: string | null): PrototypeState {
  if (raw === null) {
    return createInitialState();
  }

  try {
    const candidate = JSON.parse(raw) as unknown;
    if (!isPrototypeState(candidate)) {
      return createInitialState();
    }
    return {
      version: 1,
      trunkSlots: [...candidate.trunkSlots],
    };
  } catch {
    return createInitialState();
  }
}

function isPrototypeState(value: unknown): value is PrototypeState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<PrototypeState>;
  return candidate.version === 1
    && Array.isArray(candidate.trunkSlots)
    && candidate.trunkSlots.length === TRUNK_SLOT_COUNT
    && candidate.trunkSlots.every((item) => item === null || ITEM_IDS.includes(item));
}
