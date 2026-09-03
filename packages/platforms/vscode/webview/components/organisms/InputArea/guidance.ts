import type { BundledResourceMetadata, SkillInfo } from "@opencode-chat/core";

export type GuidanceItem = (SkillInfo & { source: "native"; type: "skill" }) | BundledResourceMetadata;

export function nativeGuidance(skill: SkillInfo): GuidanceItem {
  return { ...skill, source: "native", type: "skill" };
}
