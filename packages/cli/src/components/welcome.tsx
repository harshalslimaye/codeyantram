import React from 'react';
import { Box, Text } from 'ink';
import BigText from 'ink-big-text';
import { useTheme } from '../theme/provider.js';

export function Welcome({ width }: { width: number }) {
	const { palette } = useTheme();
	const showBanner = width >= 48;

	return (
		<Box flexDirection="column" flexShrink={0}>
			{showBanner && (
				<Box flexDirection="row" flexShrink={0}>
					<Text color={palette.primary}>
						<BigText text="Code" font="tiny" colors={['system']} />
					</Text>
					<Text color={palette.text}>
						<BigText text="Yantram" font="tiny" colors={['system']} />
					</Text>
				</Box>
			)}
			<Text bold color={palette.primary}>Welcome to CodeYantram.</Text>
			<Text color={palette.text}>Your AI companion for building, exploring, and fixing code.</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color={palette.muted}>Type a message and press Enter to get started.</Text>
				<Text color={palette.muted}>
					<Text color={palette.prompt}>/connect</Text> add an API key · <Text color={palette.prompt}>/model</Text> choose a model · <Text color={palette.prompt}>/help</Text> all commands
				</Text>
			</Box>
		</Box>
	);
}
