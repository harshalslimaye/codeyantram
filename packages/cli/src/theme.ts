export interface ThemeColors {
  bg: string;
  panel: string;
  text: string;
  accent: string;
  focus: string;
  paths: string;
  success: string;
  del: string;
  error: string;
  fill: string;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
}

export const themes: Theme[] = [
  {
    name: "Arka",
    colors: {
      bg: "#0D0D0C",
      panel: "#1A1815",
      text: "#EDE6D6",
      accent: "#5A6CD4",
      focus: "#D9A24B",
      paths: "#B58656",
      success: "#5C9464",
      del: "#C0654A",
      error: "#BB5648",
      fill: "#2B3170",
    },
  },
];

export const DEFAULT_THEME = themes.find(theme => theme.name === "Arka") as Theme;