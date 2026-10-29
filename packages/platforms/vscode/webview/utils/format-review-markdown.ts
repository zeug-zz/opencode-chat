export type ReviewMarkdownInput = {
  conclusion: string;
  status: string;
  evidence: string;
  assumptions: readonly string[];
  challenges: readonly { severity: string; target: string; reason: string }[];
  limits?: string;
};

export function formatReviewMarkdown(
  review: ReviewMarkdownInput,
  labels: { title: string; status: string; evidence: string; assumptions: string; challenges: string; limits: string },
): string {
  const sections = [
    `## ${labels.title}`,
    review.conclusion,
    `**${labels.status}:** ${review.status}`,
    `**${labels.evidence}:** ${review.evidence}`,
  ];
  if (review.assumptions.length > 0) {
    sections.push(`### ${labels.assumptions}\n${review.assumptions.map((item) => `- ${item}`).join("\n")}`);
  }
  if (review.challenges.length > 0) {
    sections.push(
      `### ${labels.challenges}\n${review.challenges.map((item) => `- **${item.severity}** · ${item.target}: ${item.reason}`).join("\n")}`,
    );
  }
  if (review.limits) sections.push(`### ${labels.limits}\n${review.limits}`);
  return sections.join("\n\n");
}
