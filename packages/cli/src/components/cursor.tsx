import React, {useEffect, useState} from 'react';
import {Text} from 'ink';

export function Cursor() {
	const [isVisible, setIsVisible] = useState(true);

	useEffect(() => {
		const interval = setInterval(() => {
			setIsVisible(visible => !visible);
		}, 500);

		return () => clearInterval(interval);
	}, []);

	return <Text color="gray">{isVisible ? '▌' : ' '}</Text>;
}
