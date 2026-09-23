// Vorgefertigte Farbthemes nach den Themes von daisyUI 5.7.43
// (https://daisyui.com, MIT © Pouya Saadeghi — siehe presetThemes.LICENSE.txt).
//
// daisyUI selbst ist keine Abhängigkeit: übernommen sind nur die Farbwerte,
// einmalig aus den OKLCH-Angaben in sRGB-Hex umgerechnet und auf die acht
// Theme-Farben der App abgebildet:
//
//   base-100      → card        (Manuskriptseite, Karten)
//   base-200      → bg
//   base-300      → panel
//   base-content  → text
//   primary       → accent,  primary-content → accentText
//   accent        → highlight
//   border        → base-200, 14 % Richtung base-content (oklab) — daisyUI
//                   kennt keine Rahmenfarbe; so bleibt der Rahmen in hellen
//                   wie dunklen Themes sichtbar.

import type { ThemeColors } from "./settings";

export interface PresetTheme {
  id: `daisy-${string}`;
  label: string;
  scheme: "light" | "dark";
  colors: ThemeColors;
}

export const PRESET_THEMES: PresetTheme[] = [
  { id: "daisy-abyss", label: "Abyss", scheme: "dark", colors: { bg: "#00111d", text: "#ffd6a7", panel: "#000611", border: "#002b2f", accent: "#bdff00", accentText: "#427600", card: "#001e29", highlight: "#505050" } },
  { id: "daisy-acid", label: "Acid", scheme: "light", colors: { bg: "#eeeeee", text: "#000000", panel: "#e1e1e1", border: "#c3c3c3", accent: "#ff00ff", accentText: "#180017", card: "#f8f8f8", highlight: "#c8ff00" } },
  { id: "daisy-aqua", label: "Aqua", scheme: "dark", colors: { bg: "#162455", text: "#b8e6fe", panel: "#091444", border: "#283d6b", accent: "#13ecf3", accentText: "#015355", card: "#1a368b", highlight: "#ffe999" } },
  { id: "daisy-autumn", label: "Autumn", scheme: "light", colors: { bg: "#dbdbdb", text: "#141414", panel: "#c5c5c5", border: "#bbbbbb", accent: "#8c0327", accentText: "#edd0d0", card: "#f1f1f1", highlight: "#d59b6b" } },
  { id: "daisy-black", label: "Black", scheme: "dark", colors: { bg: "#141414", text: "#d6d6d6", panel: "#1b1b1b", border: "#2a2a2a", accent: "#3a3a3a", accentText: "#ffffff", card: "#000000", highlight: "#3a3a3a" } },
  { id: "daisy-bumblebee", label: "Bumblebee", scheme: "light", colors: { bg: "#f5f5f5", text: "#161616", panel: "#e4e4e4", border: "#d1d1d1", accent: "#fdc700", accentText: "#733e0a", card: "#ffffff", highlight: "#000000" } },
  { id: "daisy-business", label: "Business", scheme: "dark", colors: { bg: "#1c1c1c", text: "#cdcdcd", panel: "#181818", border: "#313131", accent: "#1c4e80", accentText: "#d0dae5", card: "#202020", highlight: "#ea6947" } },
  { id: "daisy-caramellatte", label: "Caramellatte", scheme: "light", colors: { bg: "#feecd3", text: "#7c2808", panel: "#ffd6a7", border: "#edcfb6", accent: "#000000", accentText: "#ffffff", card: "#fff7ed", highlight: "#8c3f27" } },
  { id: "daisy-cmyk", label: "CMYK", scheme: "light", colors: { bg: "#eeeeee", text: "#161616", panel: "#dedede", border: "#cccccc", accent: "#45aeee", accentText: "#020b13", card: "#ffffff", highlight: "#fff234" } },
  { id: "daisy-coffee", label: "Coffee", scheme: "dark", colors: { bg: "#1e151d", text: "#c59f61", panel: "#120a11", border: "#322627", accent: "#db924c", accentText: "#110802", card: "#261b25", highlight: "#11576d" } },
  { id: "daisy-corporate", label: "Corporate", scheme: "light", colors: { bg: "#e8e8e8", text: "#181a2a", panel: "#d1d1d1", border: "#c7c7ca", accent: "#0082ce", accentText: "#ffffff", card: "#ffffff", highlight: "#009689" } },
  { id: "daisy-cupcake", label: "Cupcake", scheme: "light", colors: { bg: "#efeae6", text: "#291334", panel: "#e7e2df", border: "#d0c8cb", accent: "#44ebd3", accentText: "#005d58", card: "#faf7f5", highlight: "#ffd6a7" } },
  { id: "daisy-cyberpunk", label: "Cyberpunk", scheme: "light", colors: { bg: "#f7e83a", text: "#000000", panel: "#e3d40e", border: "#cabe2e", accent: "#ff6596", accentText: "#180408", card: "#fff248", highlight: "#ce74ff" } },
  { id: "daisy-dark", label: "Dark", scheme: "dark", colors: { bg: "#191e24", text: "#ecf9ff", panel: "#15191e", border: "#323840", accent: "#605dff", accentText: "#edf1fe", card: "#1d232a", highlight: "#00d3bb" } },
  { id: "daisy-dim", label: "Dim", scheme: "dark", colors: { bg: "#242933", text: "#b2ccd6", panel: "#20252e", border: "#363d47", accent: "#9fe88d", accentText: "#091307", card: "#2a303c", highlight: "#c792e9" } },
  { id: "daisy-dracula", label: "Dracula", scheme: "dark", colors: { bg: "#232530", text: "#f8f8f3", panel: "#1f202a", border: "#3d3e48", accent: "#ff79c6", accentText: "#16050e", card: "#282a36", highlight: "#ffb86c" } },
  { id: "daisy-emerald", label: "Emerald", scheme: "light", colors: { bg: "#e8e8e8", text: "#333c4d", panel: "#d1d1d1", border: "#ccced0", accent: "#66cc8a", accentText: "#223d30", card: "#ffffff", highlight: "#f68067" } },
  { id: "daisy-fantasy", label: "Fantasy", scheme: "light", colors: { bg: "#e8e8e8", text: "#1f2937", panel: "#d1d1d1", border: "#c8cacd", accent: "#6d0076", accentText: "#e3cee4", card: "#ffffff", highlight: "#ff8600" } },
  { id: "daisy-forest", label: "Forest", scheme: "dark", colors: { bg: "#161212", text: "#cac9c9", panel: "#110d0d", border: "#2b2727", accent: "#1fb854", accentText: "#000000", card: "#1b1717", highlight: "#1fb8ab" } },
  { id: "daisy-garden", label: "Garden", scheme: "light", colors: { bg: "#d4d2d2", text: "#100f0f", panel: "#bebdbd", border: "#b4b3b3", accent: "#fe0075", accentText: "#ffffff", card: "#e9e7e7", highlight: "#5c7f67" } },
  { id: "daisy-halloween", label: "Halloween", scheme: "dark", colors: { bg: "#0b0908", text: "#cdcdcd", panel: "#000000", border: "#201f1e", accent: "#ff8f00", accentText: "#131616", card: "#1b1816", highlight: "#42aa00" } },
  { id: "daisy-lemonade", label: "Lemonade", scheme: "light", colors: { bg: "#e1e6d9", text: "#151614", panel: "#cbcfc3", border: "#c1c5ba", accent: "#419400", accentText: "#010800", card: "#f8fdef", highlight: "#edd000" } },
  { id: "daisy-light", label: "Light", scheme: "light", colors: { bg: "#f8f8f8", text: "#18181b", panel: "#eeeeee", border: "#d5d5d5", accent: "#422ad5", accentText: "#e0e7ff", card: "#ffffff", highlight: "#00d3bb" } },
  { id: "daisy-lofi", label: "Lofi", scheme: "light", colors: { bg: "#f5f5f5", text: "#000000", panel: "#ebebeb", border: "#c8c8c8", accent: "#0d0d0d", accentText: "#ffffff", card: "#ffffff", highlight: "#262626" } },
  { id: "daisy-luxury", label: "Luxury", scheme: "dark", colors: { bg: "#171618", text: "#dca54d", panel: "#1e1d1f", border: "#2e2721", accent: "#ffffff", accentText: "#161616", card: "#09090b", highlight: "#513448" } },
  { id: "daisy-night", label: "Night", scheme: "dark", colors: { bg: "#0c1425", text: "#c9cbd0", panel: "#0a1120", border: "#222a3a", accent: "#3abdf7", accentText: "#010d15", card: "#0f172a", highlight: "#f471b5" } },
  { id: "daisy-nord", label: "Nord", scheme: "light", colors: { bg: "#e5e9f0", text: "#2e3440", panel: "#d8dee9", border: "#c9cdd5", accent: "#5e81ac", accentText: "#03060b", card: "#eceff4", highlight: "#88c0d0" } },
  { id: "daisy-pastel", label: "Pastel", scheme: "light", colors: { bg: "#f9fafb", text: "#161616", panel: "#e5e6e7", border: "#d5d6d6", accent: "#e9d4ff", accentText: "#8000d9", card: "#ffffff", highlight: "#a3f2ce" } },
  { id: "daisy-retro", label: "Retro", scheme: "light", colors: { bg: "#e4d8b4", text: "#793205", panel: "#dbca9b", border: "#d6c09c", accent: "#ff9fa0", accentText: "#801518", card: "#ece3ca", highlight: "#d08700" } },
  { id: "daisy-silk", label: "Silk", scheme: "light", colors: { bg: "#f3ede9", text: "#4b4743", panel: "#e2ddd9", border: "#d9d4d0", accent: "#1c1c29", accentText: "#e1ff00", card: "#f7f5f3", highlight: "#1c1c29" } },
  { id: "daisy-sunset", label: "Sunset", scheme: "dark", colors: { bg: "#0e171e", text: "#9fb9d0", panel: "#091319", border: "#1f2b33", accent: "#ff865b", accentText: "#160603", card: "#121c22", highlight: "#b387fa" } },
  { id: "daisy-synthwave", label: "Synthwave", scheme: "dark", colors: { bg: "#120b3d", text: "#a1b1ff", panel: "#1c184b", border: "#222055", accent: "#f861b4", accentText: "#500323", card: "#09002f", highlight: "#ff8904" } },
  { id: "daisy-valentine", label: "Valentine", scheme: "light", colors: { bg: "#f9e4f0", text: "#c5005a", panel: "#f9cbe5", border: "#f6cada", accent: "#f43098", accentText: "#ffffff", card: "#fcf2f8", highlight: "#71d1fe" } },
  { id: "daisy-winter", label: "Winter", scheme: "light", colors: { bg: "#f2f7fe", text: "#394e6a", panel: "#e3e9f4", border: "#d6dee8", accent: "#0069ff", accentText: "#cee4ff", card: "#ffffff", highlight: "#c148ac" } },
  { id: "daisy-wireframe", label: "Wireframe", scheme: "light", colors: { bg: "#f5f5f5", text: "#161616", panel: "#ebebeb", border: "#d1d1d1", accent: "#d4d4d4", accentText: "#242424", card: "#ffffff", highlight: "#d4d4d4" } },
];
