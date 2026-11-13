import { z } from "zod";
import {
  remindersResponse,
  reminderResponse,
  notificationState,
  type ReminderInput,
  type ReminderPatch,
  type NotificationDeviceInput,
  type NotificationPreferences,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { TripError } from "./trip-api";

async function request<T>(
  path: string,
  token: string,
  signal: AbortSignal,
  schema: { parse: (input: unknown) => T },
  method = "GET",
  body?: unknown,
): Promise<T> {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await fetch(`${origin}/api${path}`, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new TripError(
      data.error?.message ??
        "Could not confirm the change. Refresh before starting another save.",
      response.status,
      data.error?.fields,
    );
  try {
    return schema.parse(data);
  } catch {
    throw new TripError(
      "Could not read the response. Refresh to check the saved reminder.",
    );
  }
}
const saved = z.object({ saved: z.literal(true) });
export const reminderApi = {
  list: (tripId: string, token: string, signal: AbortSignal) =>
    request(`/trips/${tripId}/reminders`, token, signal, remindersResponse),
  create: (
    tripId: string,
    input: ReminderInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `/trips/${tripId}/reminders`,
      token,
      signal,
      reminderResponse,
      "POST",
      input,
    ),
  patch: (
    tripId: string,
    id: string,
    input: ReminderPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `/trips/${tripId}/reminders/${id}`,
      token,
      signal,
      reminderResponse,
      "PATCH",
      input,
    ),
  preferences: (token: string, signal: AbortSignal) =>
    request("/notifications", token, signal, notificationState),
  setPreferences: (
    input: Partial<NotificationPreferences>,
    token: string,
    signal: AbortSignal,
  ) =>
    request("/notifications", token, signal, notificationState, "PATCH", input),
  register: (
    input: NotificationDeviceInput,
    token: string,
    signal: AbortSignal,
  ) => request("/notifications/device", token, signal, saved, "PUT", input),
  unregister: (deviceId: string, token: string, signal: AbortSignal) =>
    request("/notifications/device", token, signal, saved, "DELETE", {
      deviceId,
    }),
};
