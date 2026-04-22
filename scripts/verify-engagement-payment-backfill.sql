-- Verifies billing-account consumed totals against legacy engagement payments.
--
-- This query expects the finance, engagements, projects, and billing schemas to
-- be visible from the same Postgres session, for example in a restored staging
-- database or through foreign data wrappers.
--
-- Usage:
--   psql "$DATABASE_URL" \
--     -v finance_schema=finance \
--     -v engagements_schema=public \
--     -v projects_schema=public \
--     -v billing_schema=billing-accounts \
--     -v exempt_billing_account_ids=80000062,80002800 \
--     -f scripts/verify-engagement-payment-backfill.sql

\set ON_ERROR_STOP on

\if :{?exempt_billing_account_ids}
\else
\set exempt_billing_account_ids '80000062,80002800'
\endif

WITH finance_payments AS (
  SELECT
    w.winning_id::text AS winning_id,
    w.winner_id::text AS winner_id,
    NULLIF(w.external_id, '') AS external_id,
    NULLIF(w.attributes->>'assignmentId', '') AS attribute_assignment_id,
    p.payment_id::text AS payment_id,
    p.total_amount::numeric AS total_amount,
    p.challenge_markup::numeric AS challenge_markup,
    p.challenge_fee::numeric AS challenge_fee
  FROM :"finance_schema".winnings w
  INNER JOIN :"finance_schema".payment p
    ON p.winnings_id = w.winning_id
  WHERE w.category::text = 'ENGAGEMENT_PAYMENT'
),
assignment_candidates AS (
  SELECT
    fp.*,
    ea.id AS assignment_id,
    ea."engagementId" AS engagement_id,
    e."projectId" AS project_id,
    'direct_assignment' AS resolution_source
  FROM finance_payments fp
  INNER JOIN :"engagements_schema"."EngagementAssignment" ea
    ON ea.id = COALESCE(fp.attribute_assignment_id, fp.external_id)
  INNER JOIN :"engagements_schema"."Engagement" e
    ON e.id = ea."engagementId"
),
engagement_member_candidates AS (
  SELECT
    fp.*,
    ea.id AS assignment_id,
    ea."engagementId" AS engagement_id,
    e."projectId" AS project_id,
    COUNT(*) OVER (PARTITION BY fp.payment_id) AS candidate_count,
    'engagement_member' AS resolution_source
  FROM finance_payments fp
  INNER JOIN :"engagements_schema"."Engagement" e
    ON e.id = fp.external_id
  INNER JOIN :"engagements_schema"."EngagementAssignment" ea
    ON ea."engagementId" = e.id
   AND ea."memberId" = fp.winner_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM assignment_candidates ac
    WHERE ac.payment_id = fp.payment_id
  )
),
engagement_single_candidates AS (
  SELECT
    fp.*,
    ea.id AS assignment_id,
    ea."engagementId" AS engagement_id,
    e."projectId" AS project_id,
    COUNT(*) OVER (PARTITION BY fp.payment_id) AS candidate_count,
    'engagement_single_assignment' AS resolution_source
  FROM finance_payments fp
  INNER JOIN :"engagements_schema"."Engagement" e
    ON e.id = fp.external_id
  INNER JOIN :"engagements_schema"."EngagementAssignment" ea
    ON ea."engagementId" = e.id
  WHERE NOT EXISTS (
    SELECT 1
    FROM assignment_candidates ac
    WHERE ac.payment_id = fp.payment_id
  )
    AND NOT EXISTS (
      SELECT 1
      FROM engagement_member_candidates emc
      WHERE emc.payment_id = fp.payment_id
    )
),
resolved_payments AS (
  SELECT
    winning_id,
    winner_id,
    external_id,
    attribute_assignment_id,
    payment_id,
    total_amount,
    challenge_markup,
    challenge_fee,
    assignment_id,
    engagement_id,
    project_id,
    resolution_source
  FROM assignment_candidates

  UNION ALL

  SELECT
    winning_id,
    winner_id,
    external_id,
    attribute_assignment_id,
    payment_id,
    total_amount,
    challenge_markup,
    challenge_fee,
    assignment_id,
    engagement_id,
    project_id,
    resolution_source
  FROM engagement_member_candidates
  WHERE candidate_count = 1

  UNION ALL

  SELECT
    winning_id,
    winner_id,
    external_id,
    attribute_assignment_id,
    payment_id,
    total_amount,
    challenge_markup,
    challenge_fee,
    assignment_id,
    engagement_id,
    project_id,
    resolution_source
  FROM engagement_single_candidates
  WHERE candidate_count = 1
),
exempt_billing_accounts AS (
  SELECT btrim(value)::int AS billing_account_id
  FROM regexp_split_to_table(:'exempt_billing_account_ids', ',') AS value
  WHERE btrim(value) <> ''
),
resolved_payment_project AS (
  SELECT
    rp.*,
    pr."billingAccountId"::int AS billing_account_id,
    EXISTS (
      SELECT 1
      FROM exempt_billing_accounts eba
      WHERE eba.billing_account_id = pr."billingAccountId"::int
    ) AS is_exempt_billing_account
  FROM resolved_payments rp
  INNER JOIN :"projects_schema".projects pr
    ON pr.id::text = rp.project_id
   AND pr."deletedAt" IS NULL
  WHERE pr."billingAccountId" IS NOT NULL
),
resolved_payment_billing AS (
  SELECT
    rpp.*,
    ba.markup AS billing_account_markup
  FROM resolved_payment_project rpp
  LEFT JOIN :"billing_schema"."BillingAccount" ba
    ON ba.id = rpp.billing_account_id
  WHERE rpp.is_exempt_billing_account
    OR (
      rpp.total_amount IS NOT NULL
      AND rpp.total_amount >= 0
      AND (rpp.challenge_markup IS NULL OR rpp.challenge_markup >= 0)
      AND (rpp.challenge_fee IS NULL OR rpp.challenge_fee >= 0)
      AND ba.id IS NOT NULL
      AND ba.markup >= 0
    )
),
expected_payment_consumes AS (
  SELECT
    rpb.assignment_id,
    rpb.billing_account_id,
    rpb.is_exempt_billing_account,
    ROUND(
      (
        CASE
          WHEN rpb.total_amount IS NULL OR rpb.total_amount < 0 THEN NULL
          WHEN rpb.challenge_markup IS NOT NULL AND rpb.challenge_markup >= 0
            THEN rpb.total_amount + (rpb.total_amount * rpb.challenge_markup)
          WHEN rpb.challenge_fee IS NOT NULL AND rpb.challenge_fee >= 0
            THEN rpb.total_amount + rpb.challenge_fee
          WHEN rpb.billing_account_markup IS NOT NULL
            THEN rpb.total_amount + (rpb.total_amount * rpb.billing_account_markup)
          ELSE NULL
        END
      )::numeric,
      4
    ) AS consumed_amount
  FROM resolved_payment_billing rpb
),
expected AS (
  SELECT
    assignment_id,
    billing_account_id,
    COUNT(*) AS payment_count,
    ROUND(SUM(consumed_amount)::numeric, 4) AS expected_consumed
  FROM expected_payment_consumes
  WHERE consumed_amount > 0
    AND NOT is_exempt_billing_account
  GROUP BY assignment_id, billing_account_id
),
exempt_expected AS (
  SELECT
    assignment_id,
    billing_account_id,
    COUNT(*) AS payment_count,
    ROUND(SUM(consumed_amount)::numeric, 4) AS expected_consumed
  FROM expected_payment_consumes
  WHERE is_exempt_billing_account
  GROUP BY assignment_id, billing_account_id
),
actual AS (
  SELECT
    "externalId" AS assignment_id,
    "billingAccountId" AS billing_account_id,
    COUNT(*) AS consumed_row_count,
    ROUND(SUM(amount)::numeric, 4) AS actual_consumed
  FROM :"billing_schema"."ConsumedAmount"
  WHERE "externalType"::text = 'ENGAGEMENT'
  GROUP BY "externalId", "billingAccountId"
),
non_exempt_actual AS (
  SELECT a.*
  FROM actual a
  WHERE NOT EXISTS (
    SELECT 1
    FROM exempt_billing_accounts eba
    WHERE eba.billing_account_id = a.billing_account_id
  )
),
comparison AS (
  SELECT
    COALESCE(e.assignment_id, a.assignment_id) AS assignment_id,
    COALESCE(e.billing_account_id, a.billing_account_id) AS billing_account_id,
    e.payment_count,
    a.consumed_row_count,
    e.expected_consumed,
    a.actual_consumed,
    CASE
      WHEN e.assignment_id IS NULL THEN 'unexpected_actual'
      WHEN a.assignment_id IS NULL THEN 'missing_actual'
      WHEN e.expected_consumed = a.actual_consumed THEN 'matches'
      ELSE 'amount_mismatch'
    END AS status
  FROM expected e
  FULL OUTER JOIN non_exempt_actual a
    ON a.assignment_id = e.assignment_id
   AND a.billing_account_id = e.billing_account_id
),
exempt_comparison AS (
  SELECT
    e.assignment_id,
    e.billing_account_id,
    e.payment_count,
    a.consumed_row_count,
    e.expected_consumed,
    a.actual_consumed,
    CASE
      WHEN a.assignment_id IS NULL THEN 'topgear_exempt_skipped'
      ELSE 'topgear_exempt_has_actual'
    END AS status
  FROM exempt_expected e
  LEFT JOIN actual a
    ON a.assignment_id = e.assignment_id
   AND a.billing_account_id = e.billing_account_id

  UNION ALL

  SELECT
    a.assignment_id,
    a.billing_account_id,
    NULL::bigint AS payment_count,
    a.consumed_row_count,
    NULL::numeric AS expected_consumed,
    a.actual_consumed,
    'topgear_exempt_unexpected_actual' AS status
  FROM actual a
  WHERE EXISTS (
      SELECT 1
      FROM exempt_billing_accounts eba
      WHERE eba.billing_account_id = a.billing_account_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM exempt_expected e
      WHERE e.assignment_id = a.assignment_id
        AND e.billing_account_id = a.billing_account_id
    )
)
SELECT
  status,
  assignment_id,
  billing_account_id,
  payment_count,
  consumed_row_count,
  expected_consumed,
  actual_consumed,
  COALESCE(actual_consumed, 0) - COALESCE(expected_consumed, 0) AS delta
FROM (
  SELECT * FROM comparison
  UNION ALL
  SELECT * FROM exempt_comparison
) results
ORDER BY
  CASE WHEN status = 'matches' THEN 1 ELSE 0 END,
  status,
  assignment_id,
  billing_account_id;
