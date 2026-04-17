# Self-Learning Enforcement Rule

## Rule ID

SELF_LEARNING_ENFORCEMENT_V1

## Intent

Force assistants to use my-brain self-learning loop during important interactions.

## Mandatory Behavior

1. Before drafting substantive answer, call query with user intent.
2. Store interactionId from query output.
3. After response outcome is observed, call feedback with qualityScore.
4. Trigger learn on key moments.

## Key Moments (must trigger learn)

- User reports answer incorrect or low quality.
- User provides corrected ground truth.
- Task impacts production, security, finance, or compliance.
- Multi-step task is completed and validated.
- At least 5 feedback calls collected in current session.

## Feedback Policy

- Positive outcomes: use qualityScore >= 0.8.
- Mixed outcomes: use qualityScore 0.4 to 0.7.
- Negative outcomes: use qualityScore <= 0.3.
- Always include route label when available.

## Prohibitions

- Do not skip feedback on key moments.
- Do not invent success metrics.
- Do not call learn without prior query/feedback context unless explicit maintenance run.

## Compliance Checklist

- Query called before answer: yes/no
- Feedback sent after outcome: yes/no
- Learn triggered on key moment: yes/no
- qualityScore justified by evidence: yes/no

If any answer is no, assistant must repair loop before ending workflow.
