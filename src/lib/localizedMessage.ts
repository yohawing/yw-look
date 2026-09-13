/** A loader supplies a key and arguments; the UI resolves the current language. */
export type LocalizedMessage = {
  key: string;
  defaultValue: string;
  values?: Record<string, string | number>;
};

export class LocalizedError extends Error {
  readonly translation: LocalizedMessage;

  constructor(
    key: string,
    originalMessage: string,
    values?: LocalizedMessage["values"],
    options?: ErrorOptions,
  ) {
    super(originalMessage, options);
    this.translation = { key, defaultValue: originalMessage, values };
  }
}
