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
    name: "Sahyadri",
    colors: {
      bg: "#0D0D0C",
      panel: "#191816",
      text: "#EDE6D6",
      accent: "#6C7CE8",
      focus: "#D9A24B",
      paths: "#B58656",
      success: "#5C9464",
      del: "#C0654A",
      error: "#BB5648",
      fill: "#292F68",
    },
  },
  {
    name: "Kaapi",
    colors: {
      bg: "#1A1715",
      panel: "#24201D",
      text: "#F2EDE5",
      accent: "#CC785C",
      focus: "#E3B778",
      paths: "#A99D92",
      success: "#7EA17A",
      del: "#C96B5C",
      error: "#C84A42",
      fill: "#332C27",
    },
  },
  {
    name: "Thirai",
    colors: {
      bg: "#2E3440",
      panel: "#3B4252",
      text: "#D8DEE9",
      accent: "#88C0D0",
      focus: "#EBCB8B",
      paths: "#81A1C1",
      success: "#A3BE8C",
      del: "#D08770",
      error: "#BF616A",
      fill: "#434C5E",
    },
  },
  {
    name: "Konkan",
    colors: {
      bg: "#282828",
      panel: "#1D2021",
      text: "#EBDBB2",
      accent: "#83A598",
      focus: "#FABD2F",
      paths: "#928374",
      success: "#B8BB26",
      del: "#FE8019",
      error: "#FB4934",
      fill: "#3C3836",
    },
  },
  {
    name: "Sanganak",
    colors: {
      bg: "#0A0A0A",
      panel: "#111111",
      text: "#D4D4D4",
      accent: "#7CFC00",
      focus: "#E5E5E5",
      paths: "#777777",
      success: "#7CFC00",
      del: "#D16969",
      error: "#F44747",
      fill: "#1C1C1C",
    },
  },
  {
    name: "Aranya",
    colors: {
      bg: "#0B1515",
      panel: "#142322",
      text: "#E8EFEA",
      accent: "#78A894",
      focus: "#D9C27A",
      paths: "#718C83",
      success: "#63A477",
      del: "#C56A62",
      error: "#B83A3A",
      fill: "#203B35",
    },
  },
  {
    name: "Gulabi",
    colors: {
      bg: "#140C11",
      panel: "#21151D",
      text: "#F4E9ED",
      accent: "#D77A9A",
      focus: "#E7C27A",
      paths: "#A8788B",
      success: "#6FA478",
      del: "#D95F67",
      error: "#C73545",
      fill: "#422431",
    },
  },
  {
    name: "Bazaar",
    colors: {
      bg: "#282A36",
      panel: "#21222C",
      text: "#F8F8F2",
      accent: "#BD93F9",
      focus: "#FFB86C",
      paths: "#6272A4",
      success: "#50FA7B",
      del: "#FF79C6",
      error: "#FF5555",
      fill: "#44475A",
    },
  },
  {
    name: "Shishir",
    colors: {
      bg: "#282C34",
      panel: "#21252B",
      text: "#ABB2BF",
      accent: "#61AFEF",
      focus: "#E5C07B",
      paths: "#7F848E",
      success: "#98C379",
      del: "#E06C75",
      error: "#E06C75",
      fill: "#3A404A",
    },
  },
  {
    name: "Ladakh",
    colors: {
      bg: "#141619",
      panel: "#1E2226",
      text: "#E8E6E1",
      accent: "#5B8CAA",
      focus: "#D2A15A",
      paths: "#7C858B",
      success: "#6FA17A",
      del: "#C66B61",
      error: "#C44747",
      fill: "#29343B",
    },
  },
  {
    name: "Oviya",
    colors: {
      bg: "#1E1E3F",
      panel: "#171735",
      text: "#F8F8FF",
      accent: "#A599E9",
      focus: "#FFCC99",
      paths: "#6D6D9A",
      success: "#A6E22E",
      del: "#FF628C",
      error: "#FF5555",
      fill: "#30305A",
    },
  },
  {
    name: "Kaadu",
    colors: {
      bg: "#272822",
      panel: "#1E1F1C",
      text: "#F8F8F2",
      accent: "#A6E22E",
      focus: "#FD971F",
      paths: "#75715E",
      success: "#A6E22E",
      del: "#F92672",
      error: "#F92672",
      fill: "#3E3D32",
    },
  },
];

export const DEFAULT_THEME =
  themes.find(theme => theme.name === "Sahyadri") as Theme;
