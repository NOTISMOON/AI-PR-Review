import "dotenv/config";
import { runReviewSafe } from "@/lib/review/graph";
import { getUserById, decryptToken } from "@/lib/db/mysql";

async function main() {
  const user = await getUserById(1);
  if (!user?.accessTokenEnc) {
    console.log("NO_USER");
    return;
  }
  const token = decryptToken(user.accessTokenEnc);
  if (!token) {
    console.log("NO_TOKEN");
    return;
  }
  console.log("审查开始 NOTISMOON/interview_tool#1 ...");
  const r = await runReviewSafe(
    {
      owner: "NOTISMOON",
      repo: "interview_tool",
      prNumber: 1,
      depth: "standard",
      token,
      writeReview: false,
      writeStatus: false,
      userId: 1,
      platform: "github",
      riskThreshold: "默认",
    },
    null,
  );
  console.log(
    "DONE:",
    JSON.stringify({ error: r.error, riskLevel: r.riskLevel, risks: r.risks?.length, writtenReview: r.writtenReview }),
  );
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
