import { continueRender, delayRender, staticFile } from "remotion";

// IBM Plex Sans Arabic (SIL OFL), the same face the app uses, split into the Arabic and
// Latin subsets that @fontsource ships. Loaded before the first frame renders.
const ARABIC =
  "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC";
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

let started = false;

export function loadFonts() {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("Loading IBM Plex Sans Arabic");
  const loads: Promise<FontFace>[] = [];
  for (const weight of [400, 500, 600, 700]) {
    for (const [subset, range] of [
      ["arabic", ARABIC],
      ["latin", LATIN],
    ] as const) {
      const face = new FontFace(
        "IBM Plex Sans Arabic",
        `url(${staticFile(`fonts/ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`)}) format("woff2")`,
        { weight: String(weight), unicodeRange: range },
      );
      document.fonts.add(face);
      loads.push(face.load());
    }
  }
  Promise.all(loads)
    .then(() => continueRender(handle))
    .catch((err) => {
      console.error(err);
      continueRender(handle);
    });
}
