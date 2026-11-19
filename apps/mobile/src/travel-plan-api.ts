import { z } from "zod";
import {
  travelStepsResponse,
  travelStepResponse,
  travelRemindersResponse,
  tripUpdatesResponse,
  type TravelStepInput,
  type TravelStepPatch,
  type TripTipInput,
  type TripTipPatch,
} from "@nmt/contracts";
import { itineraryRequest as request } from "./itinerary-api";
const saved = z.object({ saved: z.boolean() });
export const travelPlanApi = {
  read: (trip: string, token: string, signal: AbortSignal) =>
    request(trip, "/travel-steps", token, signal, travelStepsResponse),
  create: (
    trip: string,
    input: TravelStepInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      trip,
      "/travel-steps",
      token,
      signal,
      travelStepResponse,
      "POST",
      input,
    ),
  edit: (
    trip: string,
    id: string,
    input: TravelStepPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      trip,
      `/travel-steps/${id}`,
      token,
      signal,
      travelStepResponse,
      "PATCH",
      input,
    ),
  remove: (trip: string, id: string, token: string, signal: AbortSignal) =>
    request(trip, `/travel-steps/${id}`, token, signal, saved, "DELETE"),
  order: (
    trip: string,
    leg: "outbound" | "return",
    stepIds: string[],
    token: string,
    signal: AbortSignal,
  ) =>
    request(trip, "/travel-steps/order", token, signal, saved, "PUT", {
      leg,
      stepIds,
    }),
  reminders: (trip: string, token: string, signal: AbortSignal) =>
    request(trip, "/travel-reminders", token, signal, travelRemindersResponse),
  alerts: (
    trip: string,
    boardingEnabled: boolean,
    token: string,
    signal: AbortSignal,
  ) =>
    request(trip, "/travel-reminders", token, signal, saved, "PATCH", {
      boardingEnabled,
    }),
  updates: (trip: string, token: string, signal: AbortSignal) =>
    request(trip, "/updates", token, signal, tripUpdatesResponse),
  tip: (
    trip: string,
    input: TripTipInput,
    token: string,
    signal: AbortSignal,
  ) => request(trip, "/tips", token, signal, saved, "POST", input),
  editTip: (
    trip: string,
    id: string,
    input: TripTipPatch,
    token: string,
    signal: AbortSignal,
  ) => request(trip, `/tips/${id}`, token, signal, saved, "PATCH", input),
  removeTip: (trip: string, id: string, token: string, signal: AbortSignal) =>
    request(trip, `/tips/${id}`, token, signal, saved, "DELETE"),
};
