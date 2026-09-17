import assert from "node:assert/strict";
import test from "node:test";

import { EvaluationError, evaluateAgreement } from "../src/evaluate.js";

function baseAgreement() {
  return {
    agreementId: "agreement_demo_001",
    amountMinor: 100_000,
    currency: "USDC",
    policy: {
      conflictSpread: 35,
      criticalFailureCapPercent: 20,
    },
    criteria: [
      {
        id: "api",
        description: "The API is publicly reachable.",
        weight: 60,
        critical: true,
        minimumEvidence: 1,
      },
      {
        id: "docs",
        description: "The integration is documented.",
        weight: 40,
        critical: false,
        minimumEvidence: 1,
      },
    ],
    evidence: [
      {
        id: "e_api",
        criterionId: "api",
        kind: "automated_test",
        uri: "https://example.com/proofs/api.json",
        digest: `sha256:${"a".repeat(64)}`,
        result: "pass",
      },
      {
        id: "e_docs",
        criterionId: "docs",
        kind: "artifact",
        uri: "https://example.com/docs",
        digest: `sha256:${"b".repeat(64)}`,
        result: "pass",
      },
    ],
    findings: [
      {
        id: "f_api",
        criterionId: "api",
        evaluator: "reviewer-a",
        score: 100,
        confidence: 1,
        evidenceIds: ["e_api"],
        rationale: "The public smoke test passed.",
      },
      {
        id: "f_docs",
        criterionId: "docs",
        evaluator: "reviewer-a",
        score: 100,
        confidence: 1,
        evidenceIds: ["e_docs"],
        rationale: "The documented call reproduced successfully.",
      },
    ],
  };
}

test("recommends a full release when every criterion is fully satisfied", () => {
  const result = evaluateAgreement(baseAgreement());

  assert.equal(result.decision, "release_full");
  assert.equal(result.recommendedReleaseMinor, 100_000);
  assert.equal(result.recommendedHoldMinor, 0);
  assert.equal(result.settlementRatioBps, 10_000);
  assert.deepEqual(result.reasonCodes, []);
});

test("recommends a proportional release from weighted criterion scores", () => {
  const agreement = baseAgreement();
  agreement.findings[1].score = 50;

  const result = evaluateAgreement(agreement);

  assert.equal(result.decision, "release_partial");
  assert.equal(result.recommendedReleaseMinor, 80_000);
  assert.equal(result.recommendedHoldMinor, 20_000);
  assert.equal(result.settlementRatioBps, 8_000);
  assert.equal(result.criteria[1].earnedMinor, 20_000);
});

test("applies the declared cap when a critical criterion fails", () => {
  const agreement = baseAgreement();
  agreement.evidence[0].result = "fail";
  agreement.findings[0].score = 90;

  const result = evaluateAgreement(agreement);

  assert.equal(result.decision, "release_partial");
  assert.equal(result.recommendedReleaseMinor, 20_000);
  assert.equal(result.recommendedHoldMinor, 80_000);
  assert.ok(result.reasonCodes.includes("CRITICAL_CRITERION_FAILED"));
  assert.equal(result.criteria[0].score, 49);
});

test("routes materially conflicting findings to manual review", () => {
  const agreement = baseAgreement();
  agreement.findings.push({
    id: "f_api_conflict",
    criterionId: "api",
    evaluator: "reviewer-b",
    score: 40,
    confidence: 1,
    evidenceIds: ["e_api"],
    rationale: "The endpoint was reachable but returned an invalid body.",
  });

  const result = evaluateAgreement(agreement);

  assert.equal(result.decision, "manual_review");
  assert.equal(result.recommendedReleaseMinor, null);
  assert.equal(result.recommendedHoldMinor, null);
  assert.ok(result.reasonCodes.includes("EVALUATOR_CONFLICT"));
});

test("rejects agreements whose criterion weights do not total 100", () => {
  const agreement = baseAgreement();
  agreement.criteria[1].weight = 30;

  assert.throws(
    () => evaluateAgreement(agreement),
    (error) =>
      error instanceof EvaluationError &&
      error.code === "INVALID_CRITERIA_WEIGHT_TOTAL",
  );
});

test("rejects duplicate identifiers before producing a recommendation", () => {
  const agreement = baseAgreement();
  agreement.evidence[1].id = "e_api";

  assert.throws(
    () => evaluateAgreement(agreement),
    (error) =>
      error instanceof EvaluationError && error.code === "DUPLICATE_ID",
  );
});

test("produces the same evaluation ID for semantically identical input", () => {
  const first = evaluateAgreement(baseAgreement());
  const second = evaluateAgreement(
    JSON.parse(JSON.stringify(baseAgreement())),
  );

  assert.match(first.evaluationId, /^eval_[a-f0-9]{32}$/);
  assert.equal(first.evaluationId, second.evaluationId);
});
