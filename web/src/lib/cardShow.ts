import { createContext, useContext } from "react";

/** What a task's card (and row) shows besides its title (#269). Chosen in
 *  View › Show on Cards, per Project. */
export type CardShow = {
  notes: boolean;
  /** When the board isn't by status: which status it's in. */
  status: boolean;
  labels: boolean;
  date: boolean;
  givenTo: boolean;
  checklist: boolean;
  comments: boolean;
};

export const CARD_SHOW: CardShow = { notes: false, status: true, labels: true, date: true, givenTo: true, checklist: true, comments: true };

export const CARD_SHOW_CHOICES: [keyof CardShow, string][] = [
  ["notes", "Notes"],
  ["status", "Status"],
  ["labels", "Labels"],
  ["date", "Date"],
  ["givenTo", "Given To"],
  ["checklist", "Checklist"],
  ["comments", "Comments"],
];

export const CardShowContext = createContext<CardShow>(CARD_SHOW);

/** What to show, filling in any choice saved before it existed. */
export function useCardShow(): CardShow {
  return { ...CARD_SHOW, ...useContext(CardShowContext) };
}
