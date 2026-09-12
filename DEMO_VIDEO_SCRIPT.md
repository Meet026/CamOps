# Sentinel — Demo Video Script, Storytelling Version (~5 minutes)

Same facts, same features, same honest caveats as before — told as one
continuous scene instead of a feature tour. Speak it like you're telling
someone what happened last night, not presenting slides. Let pauses breathe;
you don't need to fill every second with words.

**Before recording:** log in as an admin, and make sure all services
(backend, frontend, video-stream relay) are running. Do one silent
walkthrough first so nothing surprises you on camera.

---

## 0. Cold open (0:00 – 0:20)

_[Screen: Login page]_

> "It's late. A call comes in — a vehicle involved in an incident, last seen
> near a busy junction in the city. The officer on duty doesn't know that
> junction's cameras. They don't know if those cameras even work today. And
> right now, across 26-plus government departments, nobody has one shared
> answer to that. That's the gap Sentinel closes. Let me show you the night
> this could have gone differently."

_Log in._

---

## 1. The first thing she sees (0:20 – 0:40)

_[Screen: Overview page]_

> "She logs in, and this is what greets her — not a wall of menus, one
> screen. How many cameras exist. How many are online right now. How many
> are quietly at risk of going dark. And how many AI suggestions are
> waiting on a human to confirm them. In five seconds, she knows the state
> of the whole network."

---

## 2. Finding the camera that matters (0:40 – 1:25)

_[Screen: Camera list page]_

> "She needs the camera near that junction. This is the registry — every
> camera any department has ever registered, its status, how hard it'd be
> to plug into deeper analysis, and who owns it."

_Type into the search bar._

> "She types the street name. It's there in an instant — search reaches the
> camera's name and its address both."

_Click Add Camera / open the form._

> "And when a field officer finds a camera that was never logged? Adding one
> takes seconds — a name, a department, and a location captured with one tap
> of GPS on their phone. Type in the brand and model, and the system quietly
> tells you how hard this camera will be to integrate — easy, medium, hard,
> or an honest 'needs a person to check' — no technical knowledge required."

_Show Edit and Delete._

> "Nothing here is ever truly erased, either. Remove a camera and it's
> marked inactive, not deleted — because this record might need to hold up
> as evidence one day."

_Show Bulk Upload page._

> "And when a whole department needs to onboard hundreds of existing
> cameras at once? One spreadsheet, dropped in here, processed in the
> background — with a live bar showing exactly which rows succeeded and
> which didn't, instead of one bad row freezing everything."

---

## 3. Seeing the whole picture (1:25 – 2:05)

_[Screen: GIS Map page]_

> "She switches to the map. Every camera, exactly where it really sits,
> color-coded by whether it's alive or how ready it is to integrate."

_Toggle the Coverage Gap overlay._

> "This overlay is the quiet, important one — it grids the whole region and
> shows where there's no camera at all. Not a guess. A live calculation
> against real registered cameras — so as departments add more, these gaps
> genuinely close."

_Toggle the Heatmap overlay._

> "And this layer shows where incidents cluster — so the next camera gets
> placed where it's actually needed, not just wherever's convenient."

---

## 4. A face on the feed (2:05 – 2:25)

_[Screen: Live Stream page]_

> "She doesn't just need to know a camera exists — sometimes she needs to
> see through it, right now."

_Click into one camera._

> "One click, and she's watching that junction live, in the browser. No
> separate video system to open."

---

## 5. The camera that's been quiet, and the trail behind everything (2:25 – 2:55)

_[Screen: Health page]_

> "Here's a fact that should worry everyone — studies show 30 to 40 percent
> of government CCTV cameras are dead at any given moment, and nobody's
> watching to notice. Sentinel checks every camera's pulse on a schedule,
> and flags anything that keeps going dark as 'at risk' — so a broken camera
> gets a repair ticket instead of years of silence."

_[Screen: Audit Log page]_

> "And behind her, every single thing anyone has done in this system —
> every login, every edit, every deletion — is written down automatically.
> Who, when, from where, and exactly what changed. For a police system,
> that trail isn't a nice-to-have. It's the whole point."

---

## 6. Who gets to see what (2:55 – 3:15)

_[Screen: Settings page]_

> "Behind the scenes, admins decide exactly who sees what — a field officer,
> a department viewer, an auditor — each with precisely the access their job
> needs, nothing more."

_Toggle dark/light theme._

> "Small touch, but a real one — light or dark, for whatever hour she's
> working."

---

## 7. The vehicle (3:15 – 3:55)

_[Screen: Vehicle Search page]_

> "Now — back to that vehicle. She has a plate number, and she knows the
> last camera that saw it. She types both in."

_Enter plate `GJ01AB1234`, select camera "Navrangpura Cross Roads", submit.
Let the staged processing play out, then the route renders._

> "And the system reaches outward through the real camera network — real
> distances, real timestamps — and lays out where that vehicle has been."

---

## 8. The alert that finds you first (3:55 – 4:10)

_[Screen: point at the bell icon in the top bar, next to "Synced"]_

> "And imagine she never had to search at all — this bell watches every
> camera, around the clock, and would have told her the moment that vehicle
> appeared. Same honest note: the alert logic is ready and waiting on that
> same recognition model."

---

## 9. What holds it up, and what's coming (4:10 – 4:50)

_[Screen: doesn't matter — talk over Overview or Settings]_

> "None of this means anything if it can't be trusted. Every user only ever
> does what their role allows — a department viewer can never even glimpse
> another department's cameras. No password is ever stored in plain text.
> And because every department's data already stands apart from the others,
> this grows to all 26-plus departments without a single redesign."

> "So what's next? First — already underway — we're training our vehicle
> recognition model from 500 vehicles up to 10,000, and pairing it with real
> license-plate reading, so a dirty or damaged plate is never a dead end.
> That's the piece that turns tonight's story fully real. Second, two-factor
> authentication at login. Third, turning all this data into trend reports a
> department can actually act on — not just a map to look at."

---

## 10. Where the story ends (4:50 – 5:10)

_[Screen: back to Overview]_

> "That's the night that could have gone differently. One registry for
> every camera, every department. A map that shows what's covered and
> what's not. A network that watches its own health so nothing goes dark
> unnoticed. A record of everything, for everyone who's accountable. And a
> way to follow a vehicle across a city built on our own real cameras.
> Thank you."

---

## Quick reference — what to type/click, in order

| Step                       | Action                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Overview                   | just navigate there                                                                               |
| Cameras                    | search a name → open Add Camera form → show Edit/Delete → open Bulk Upload                        |
| Map                        | toggle Coverage Gap → toggle Heatmap                                                              |
| Live Stream                | click into one camera                                                                             |
| Health                     | just navigate there                                                                               |
| Audit Log                  | just navigate there                                                                               |
| Settings                   | show user list/roles → toggle theme                                                               |
| Vehicle Search             | plate `GJ01AB1234` + camera "Navrangpura Cross Roads" → let it run                                |
| Watchlist alerts           | click the bell icon in the top bar (next to "Synced") → show the panel / a toast if one has fired |
| Security / scale / roadmap | no clicking needed — talk over Overview or Settings                                               |

**One honest line to keep in both the Vehicle Search and Watchlist beats,
always:** the plate reading itself is the next model we're integrating —
everything else shown (camera network, routing, geography) is real and
running live.
