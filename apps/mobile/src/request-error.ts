export class TripError extends Error {
  constructor(
    message: string,
    public status = 0,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
