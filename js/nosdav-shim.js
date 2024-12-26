// shim
const originalFetch = window.fetch

window.fetch = async function (url, options) {
  const newOptions = { ...options }

  if (newOptions.method === 'PUT') {
    const event = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url]],
      content: ''
    }

    let auth
    if (!localStorage.getItem('nostr:privkey') && window.nostr) {
      // Attempt to sign with the extension
      const signedEvent = await window.nostr.signEvent(event)
      auth = `Nostr ${btoa(JSON.stringify(signedEvent))}`
    } else {
      // Fallback to signing with localStorage private key
      const privkey = localStorage.getItem('nostr:privkey')
      if (privkey) {
        const pubkey = secp256k1.utils.bytesToHex(
          secp256k1.schnorr.getPublicKey(privkey)
        )
        event.pubkey = pubkey // Add pubkey to the event
        const signedEvent = await signEventWithPrivkey(event, privkey)
        auth = `Nostr ${btoa(JSON.stringify(signedEvent))}`
      }
    }

    if (auth) {
      newOptions.headers = {
        ...newOptions.headers,
        authorization: auth
      }
    }
  }

  return originalFetch.call(this, url, newOptions)
}

async function signEventWithPrivkey(event, privkey) {
  console.log('Signing event:', event)
  console.log('Using private key:', privkey)

  // Convert the event to a string for signing
  const eventString = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ])

  // Convert the string to bytes for signing
  const eventBytes = new TextEncoder().encode(eventString)

  // Hash the event bytes
  const eventHash = await secp256k1.utils.sha256(eventBytes)

  // Sign the hash with the private key
  const signatureBytes = await secp256k1.schnorr.sign(eventHash, privkey)
  const signature = secp256k1.utils.bytesToHex(signatureBytes)

  console.log('Generated signature:', signature)
  return { ...event, sig: signature }
}
