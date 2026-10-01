import React, {useEffect, useState} from 'react';
import {Text} from 'ink';
import {useTheme} from '../theme/provider.js';

export function Cursor() {
	const [isVisible, setIsVisible] = useState(true);
	const {palette} = useTheme();

	useEffect(() => {
		const interval = setInterval(() => {
			setIsVisible(visible => !visible);
		}, 500);

		return () => clearInterval(interval);
	}, []);

	return <Text color={palette.prompt}>{isVisible ? '▌' : ' '}</Text>;
}
