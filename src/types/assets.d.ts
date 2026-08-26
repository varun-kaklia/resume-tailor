/** The LaTeX template ships as a string, imported through Vite's `?raw` loader. */
declare module '*.tex?raw' {
  const content: string;
  export default content;
}
