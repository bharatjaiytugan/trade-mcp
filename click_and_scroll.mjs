import CDP from 'chrome-remote-interface';

const targetId = process.argv[2];
const searchText = process.argv[3];

const client = await CDP({ target: targetId, port: 9222 });
const { Runtime } = client;
await Runtime.enable();

const expr = `
(function() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent.trim() === ${JSON.stringify(searchText)}) {
      let el = node.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        if (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON' || el.tagName === 'TD') {
          el.scrollIntoView({block: 'center'});
          const opened = el.className.includes('groupOpened');
          if (!opened) el.click();
          return 'target found, wasOpened=' + opened + ', clicked=' + (!opened);
        }
        el = el.parentElement;
      }
      node.parentElement.scrollIntoView({block: 'center'});
      return 'fallback scroll only';
    }
  }
  return 'NOT FOUND';
})()
`;
const result = await Runtime.evaluate({ expression: expr, returnByValue: true });
console.log(result.result.value);
await client.close();
