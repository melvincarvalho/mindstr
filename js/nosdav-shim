const originalFetch = window.fetch;

window.fetch = async function(url, options) {
  const newOptions = { ...options };


  if (newOptions.method === 'PUT') {
    const event = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['url', url]],
      content: ''
    }
    const signedEvent = await window.nostr.signEvent(event)
    var auth = `Nostr ${btoa(JSON.stringify(signedEvent))}`
  

    newOptions.headers = {
      ...newOptions.headers,
      'authorization': auth
    };
  }

  return originalFetch.call(this, url, newOptions);
};
