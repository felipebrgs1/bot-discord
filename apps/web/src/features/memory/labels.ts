export const KIND_LABEL: Record<string, string> = {
  fact: "fato",
  preference: "preferência",
  lesson: "lição",
  episode: "episódio",
  culture: "referência",
  procedure: "procedimento",
};

export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;
