/** Text with its `quoted` parts as code, as the Core quotes commands and settings in messages. */
export function Quoted({ text }: { text: string }) {
  // Splitting on a captured group puts the quoted parts at odd places.
  return text.split(/`([^`]+)`/).map((part, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text, in its order
    i % 2 === 1 ? <code key={i}>{part}</code> : part,
  );
}
