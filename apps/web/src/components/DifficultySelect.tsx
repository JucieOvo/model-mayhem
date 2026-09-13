/**
 * 对战难度选择控件。
 *
 * 作者：JucieOvo
 *
 * 难度会真实传给服务端并影响 Agent 的决策策略，不在浏览器侧伪造对手行为。
 */

import type { MatchDifficulty } from "@modelmayhem/contracts";

const difficultyLabels: Readonly<Record<MatchDifficulty, string>> = {
  trainee: "训练",
  standard: "标准",
  adversarial: "对抗",
};

export function DifficultySelect({
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  readonly value: MatchDifficulty;
  readonly onChange: (value: MatchDifficulty) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  return (
    <label className={["difficulty-control", className].filter(Boolean).join(" ")}>
      <span>对手难度</span>
      <select
        className="field"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as MatchDifficulty)}
      >
        {(Object.keys(difficultyLabels) as MatchDifficulty[]).map((difficulty) => (
          <option key={difficulty} value={difficulty}>
            {difficultyLabels[difficulty]}
          </option>
        ))}
      </select>
    </label>
  );
}
