import { html, Component } from 'https://unpkg.com/htm/preact/standalone.module.js'

function setCurrentUser(user) {
  localStorage.setItem('currentUser', user);
}

async function getCurrentUser() {
  var currentUser = localStorage.getItem('currentUser');
  if (currentUser) {
    return currentUser;
  } else {
    currentUser = await window.nostr.getPublicKey();
    currentUser = 'nostr:pubkey:' + currentUser;
    setCurrentUser(currentUser);
    return currentUser;
  }
}

async function currentUserProfile() {
  var user = await getCurrentUser();
  if (!user) {
    return null;
  }

  if (localStorage.getItem('currentUserProfile')) {
    return JSON.parse(localStorage.getItem('currentUserProfile'));
  }

  var cacheUri = 'https://nostr.social';

  console.log('currentUserProfile', user)

  if (!user) {
    return null;
  }
  try {
    const response = await fetch(`${cacheUri}/.well-known/nostr/pubkey/${user?.replace('nostr:pubkey:', '')}/index.json`);
    const data = await response.json();

    localStorage.setItem('currentUserProfile', JSON.stringify(data));
    return data

  } catch (error) {
    console.error('Error:', error);
  }
}

function login() {
  var user = getCurrentUser();
  if (user) {
    return user;
  } else {
    return null;
  }
}

function logout() {
  localStorage.removeItem('currentUser');
  localStorage.removeItem('currentUserProfile');
}

class Navbar extends Component {
  constructor(props) {
    super(props);
    this.state = {
      links: [],
      isAuthenticated: false,
      user: { name: 'Guest' }
    };
  }

  handleLogin = async () => {
    console.log('handleLogin');

    // get current state
    var isAuthenticated = this.state.isAuthenticated;

    if (isAuthenticated) {
      // logout
      logout();
      this.setState({ isAuthenticated: false });
    } else {
      // login
      var user = await getCurrentUser();
      var profile = await currentUserProfile();
      console.log('profile', profile.mainEntity.name);
      this.setState({ isAuthenticated: true, user: profile.mainEntity });
    }
  };

  render() {
    const links = this.props.links || [
      { '@id': '#home', label: 'Home' }
    ]

    const loginButtonText = this.state.isAuthenticated ? `Welcome, ${this.state.user.name}` : 'Login';

    return html`
      <nav style="${style.nav}">
        <div style="${style.linksContainer}">
          ${links.map(link => html`
            <a href=${link['@id']} style="${style.link}" 
              onmouseover=${e => e.currentTarget.style.color = '#343a40'}
              onmouseout=${e => e.currentTarget.style.color = '#6c757d'}
            >
              ${link.label}
            </a>
          `)}
        </div>
        <button style="${style.button}"
          onmouseover=${e => { e.currentTarget.style.color = '#343a40'; e.currentTarget.style.cursor = 'pointer'; }}
          onmouseout=${e => { e.currentTarget.style.color = '#6c757d'; e.currentTarget.style.cursor = 'default'; }}
          onclick=${this.handleLogin}
        >
          ${loginButtonText}
        </button>
      </nav>
    `;
  }
}

// Styles object for better organization
const style = {
  nav: `
    display: flex;
    justify-content: space-between;
    padding: 10px 50px;
    background-color: #f8f9fa;
    border-bottom: 1px solid #e5e5e5;
    box-sizing: border-box;
    flex-wrap: wrap; // allow items to wrap to next line on smaller screens
  `,
  linksContainer: `
    display: flex;
    flex-wrap: wrap; // allow links to wrap to next line
  `,
  link: `
    color: #6c757d; 
    text-decoration: none; 
    margin-left: 140px; 
    padding: 0 15px;
    @media (max-width: 768px) {
      margin-left: 20px; // reduce margin for mobile view
      margin-bottom: 10px; // spacing between stacked items
    }
  `,
  button: `
    color: #6c757d; 
    text-decoration: none; 
    padding: 0 15px; 
    border: none; 
    background: none;
    @media (max-width: 768px) {
      margin-top: 10px; // spacing from links in mobile view
    }
  `
}

export default Navbar
