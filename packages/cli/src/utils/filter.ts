/** Case-insensitive prefix match on `getLabel(item)`, for use as an `OverlayList` `filter`. */
export function prefixFilter<T>(getLabel: (item: T) => string) {
    return (item: T, query: string) => getLabel(item).toLowerCase().startsWith(query.toLowerCase());
}
