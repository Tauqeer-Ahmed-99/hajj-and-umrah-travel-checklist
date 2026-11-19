import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
async function fixture(t) {
  const state = `export const state={reminders:[],labels:{},deadlines:true,tripChanges:true,scheduled:[],calls:[],cancelled:[],registrations:[]};`;
  const result = await build({
    stdin: {
      contents: `export * from './src/native-notifications';export {state} from 'qa-state';`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "native-boundary",
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(expo-notifications|expo-constants|expo-crypto|@react-native-async-storage\/async-storage|qa-state|\.\/(reminder-api|trip-api|travel-plan-api))$/,
            },
            (a) => ({ path: a.path, namespace: "qa" }),
          );
          b.onLoad({ filter: /.*/, namespace: "qa" }, (a) => ({
            contents: {
              "qa-state": state,
              "expo-notifications": `import {state} from 'qa-state';export const setNotificationHandler=()=>{};export const AndroidImportance={DEFAULT:3},AndroidNotificationVisibility={PRIVATE:0},SchedulableTriggerInputTypes={DATE:'date'};export const setNotificationChannelAsync=async()=>{},getPermissionsAsync=async()=>({granted:true}),requestPermissionsAsync=async()=>({granted:true}),getExpoPushTokenAsync=async()=>({data:'ExpoPushToken[owned-test]'}),dismissAllNotificationsAsync=async()=>{};export const getAllScheduledNotificationsAsync=async()=>state.scheduled;export const scheduleNotificationAsync=async value=>{state.calls.push(value);state.scheduled.push(value);return value.identifier};export const cancelScheduledNotificationAsync=async id=>{state.cancelled.push(id);state.scheduled=state.scheduled.filter(s=>s.identifier!==id)};`,
              "expo-constants": `export default {expoConfig:{extra:{eas:{projectId:'owned-project'}}}};`,
              "expo-crypto": `export const randomUUID=()=> 'owned-device';`,
              "@react-native-async-storage/async-storage": `const data=new Map();export default {getItem:async k=>data.get(k)??null,setItem:async(k,v)=>{data.set(k,v)},removeItem:async k=>{data.delete(k)},multiRemove:async ks=>{ks.forEach(k=>data.delete(k))}};`,
              "./reminder-api": `import {state} from 'qa-state';export const reminderApi={preferences:async()=>({preferences:{assignments:false,deadlines:state.deadlines,tripChanges:state.tripChanges}}),list:async()=>({reminders:[]}),unregister:async()=>{},register:async body=>{state.registrations.push(body)}};`,
              "./trip-api": `export const tripApi={list:async()=>({trips:[{id:'trip'}]})};`,
              "./travel-plan-api": `import {state} from 'qa-state';export const travelPlanApi={reminders:async()=>({reminders:state.reminders,labels:state.labels})};`,
            }[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const path = join(tmpdir(), `tc-notification-${randomUUID()}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  t.after(() => unlink(path));
  return import(pathToFileURL(path).href);
}
test("native boarding alerts add four earlier instants without replaying existing alerts, replace edits, and cancel on preference/session changes", async (t) => {
  const app = await fixture(t),
    state = app.state,
    departure = Date.now() + 48 * 3600000;
  const offsets = [1440, 600, 300, 120, 60, 30, 15, 10, 5, 0];
  const allReminders = offsets.map((offset) => ({
    id: `step-${offset}`,
    tripId: "trip",
    ownerMemberId: "member",
    dismissed: false,
    needsReview: false,
    version: 1,
    dueAt: {
      dateTime: new Date(departure - offset * 60000).toISOString(),
      timeZone: "Asia/Kolkata",
    },
  }));
  state.reminders = allReminders.slice(4);
  state.labels = Object.fromEntries(
    allReminders.map((r, i) => [
      r.id,
      `Train boarding ${offsets[i] === 0 ? "now" : offsets[i] >= 60 ? `in ${offsets[i] / 60} ${offsets[i] === 60 ? "hour" : "hours"}` : `in ${offsets[i]} minutes`}.`,
    ]),
  );
  app.setNotificationSession("member", "session");
  const sync = () =>
    app.synchronizeNotifications(
      "member",
      "session",
      "verified-test-token",
      new AbortController().signal,
    );
  await sync();
  assert.equal(state.calls.length, 6);
  assert.deepEqual(
    state.calls.map((c) => c.trigger.date.getTime()),
    state.reminders.map((r) => Date.parse(r.dueAt.dateTime)),
  );
  assert.ok(
    state.calls.every(
      (c) =>
        c.trigger.delivery === "bestEffort" &&
        c.content.body.startsWith("Train boarding") &&
        !c.content.body.includes("PRIVATE"),
    ),
  );
  await sync();
  assert.equal(state.calls.length, 6, "Refreshing cannot schedule duplicates");
  state.reminders = allReminders;
  await sync();
  assert.equal(state.calls.length, 10, "Only the four new alerts are added");
  assert.deepEqual(
    state.calls.slice(6).map((c) => c.trigger.date.getTime()),
    allReminders.slice(0, 4).map((r) => Date.parse(r.dueAt.dateTime)),
  );
  await sync();
  assert.equal(state.calls.length, 10, "A repeated sync cannot replay alerts");
  state.reminders = state.reminders.map((r) => ({
    ...r,
    version: 2,
    dueAt: {
      ...r.dueAt,
      dateTime: new Date(Date.parse(r.dueAt.dateTime) + 60000).toISOString(),
    },
  }));
  await sync();
  assert.equal(state.calls.length, 20);
  assert.equal(state.cancelled.length, 10);
  assert.ok(
    state.registrations.at(-1).localSchedules.every((s) => s.version === 2),
  );
  state.deadlines = false;
  await sync();
  assert.equal(state.scheduled.length, 0);
  state.deadlines = true;
  await sync();
  assert.equal(state.scheduled.length, 10);
  app.setNotificationSession(null, null);
  await app.clearNotifications();
  assert.equal(state.scheduled.length, 0);
});
