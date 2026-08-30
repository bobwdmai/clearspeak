const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

export function tokenize(text = '') {
  return (text.toLocaleLowerCase().match(WORD_PATTERN) || []).map((word) =>
    word.replaceAll('’', "'")
  );
}

export function alignWords(targetText, transcriptText) {
  const target = tokenize(targetText);
  const heard = tokenize(transcriptText);
  const rows = target.length + 1;
  const cols = heard.length + 1;
  const cost = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) cost[i][0] = i;
  for (let j = 0; j < cols; j += 1) cost[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitution = cost[i - 1][j - 1] + (target[i - 1] === heard[j - 1] ? 0 : 1);
      cost[i][j] = Math.min(substitution, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }

  const alignment = [];
  const insertions = [];
  let i = target.length;
  let j = heard.length;

  while (i > 0 || j > 0) {
    // Preserve exact matches first. When several edit paths have the same cost,
    // prefer an insertion/deletion over a substitution so nearby matches remain
    // aligned (for example: "fox jumps" vs "jumps today").
    if (i > 0 && j > 0 && target[i - 1] === heard[j - 1] && cost[i][j] === cost[i - 1][j - 1]) {
      alignment.push({ op: 'match', targetWord: target[i - 1], heardWord: heard[j - 1] });
      i -= 1;
      j -= 1;
      continue;
    }
    if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      alignment.push({ op: 'deletion', targetWord: target[i - 1], heardWord: '' });
      i -= 1;
    } else if (j > 0 && cost[i][j] === cost[i][j - 1] + 1) {
      insertions.push(heard[j - 1]);
      j -= 1;
    } else {
      alignment.push({ op: 'sub', targetWord: target[i - 1], heardWord: heard[j - 1] });
      i -= 1;
      j -= 1;
    }
  }

  alignment.reverse();
  insertions.reverse();
  const matches = alignment.filter(({ op }) => op === 'match').length;

  return {
    targetTokens: target,
    transcriptTokens: heard,
    wordAlignment: alignment,
    insertions,
    clarityScore: target.length ? Math.round((matches / target.length) * 100) : 0
  };
}
