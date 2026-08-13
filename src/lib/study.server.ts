export type StudyMode = "quiz" | "flashcards" | "summary";

export const STUDY_SYSTEM_PROMPT = `You are Solution.AI's study-set generator. You work ONLY from the provided excerpts of the student's own document.
- Never invent facts that are not supported by the excerpts.
- Always record the page number an item came from when it is available.
- Keep language clear and exam-focused.`;

export function studyInstruction(mode: StudyMode, count: number) {
  if (mode === "quiz") {
    return `Write ${count} multiple-choice questions. Each has exactly 4 options, one correct answer (as its 0-based index), and a one-sentence explanation.`;
  }
  if (mode === "flashcards") {
    return `Write ${count} flashcards. Front = a short prompt or term, back = a concise, complete answer.`;
  }
  return `Write a structured revision summary: 5-9 key sections, each with a short heading and 1-3 sentence explanation, ordered as the document presents them.`;
}
