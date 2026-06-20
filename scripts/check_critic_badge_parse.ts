import { parseCriticScores } from "../lib/explore/critic-score";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { console.error("FAIL:", name); failures++; }
  else console.log("ok:", name);
}

const good = JSON.stringify({
  critics: [
    { abbr: "JS", critic: "James Suckling", score_native: "100", score_value: 100 },
    { abbr: "WA", critic: "Wine Advocate", score_native: "99", score_value: 99 },
    { abbr: "WS", critic: "Wine Spectator", score_native: "95", score_value: 95 },
  ],
  community: [], medals: [], rows_total: 3,
});

const r = parseCriticScores(100, good);
check("valid parses", r !== null);
check("critics length 3", r!.critics.length === 3);
check("sorted desc", r!.critics[0].score_value >= r!.critics[1].score_value);
check("lead is score_max match", r!.lead.abbr === "JS" && r!.lead.score_value === 100);
check("overflow count = 2", r!.overflow === 2);
check("aria-label full", r!.ariaLabel.includes("James Suckling 100") && r!.ariaLabel.includes("Wine Spectator 95"));
check("float lead match", parseCriticScores(100.0, good)!.lead.abbr === "JS");
check("malformed → null", parseCriticScores(90, "{not json") === null);
check("empty critics → null", parseCriticScores(90, JSON.stringify({ critics: [], community: [], medals: [] })) === null);
check("null scoreMax → null", parseCriticScores(null, good) === null);
const noMatch = parseCriticScores(101, good);
check("fallback lead = critics[0]", noMatch !== null && noMatch.lead.abbr === "JS");
check("maxCritics cap", parseCriticScores(100, good, 2)!.critics.length === 2);

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("\nALL PASS");
