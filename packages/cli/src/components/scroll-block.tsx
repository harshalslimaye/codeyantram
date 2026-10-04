import React, {useEffect, useRef, type ReactNode} from 'react';
import {Box, measureElement, type DOMElement} from 'ink';

/** Keep a rich block measured while exposing only its visible rows in scrollback. */
export function ScrollBlock({id, start, height, visibleStart, visibleEnd, onMeasure, children}: {
	id: string;
	start: number;
	height: number;
	visibleStart: number;
	visibleEnd: number;
	onMeasure: (id: string, height: number) => void;
	children: ReactNode;
}) {
	const content = useRef<DOMElement>(null);
	useEffect(() => {
		if (content.current) onMeasure(id, Math.ceil(measureElement(content.current).height));
	});
	const visibleHeight = Math.max(0, Math.min(start + height, visibleEnd) - Math.max(start, visibleStart));
	const hiddenRows = Math.max(0, visibleStart - start);
	return (
		<Box height={visibleHeight} flexShrink={0} overflow="hidden">
			<Box ref={content} position="absolute" top={-hiddenRows} width="100%" flexDirection="column" paddingBottom={1}>
				{children}
			</Box>
		</Box>
	);
}
