import { getViewerId } from './viewer'

export const getProfile= async (address) => {
  // Determine the base URL based on the environment
  const isServer = typeof window === 'undefined'
  const baseUrl = isServer ? process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000' : ''
  const url = `${baseUrl}/api/v1/users/profile/${address.toLowerCase()}`

  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Profile fetch failed')
  const data = await response.json()
  return data
}

/**
 * Get Universal Profile via internal API proxy
 * @param {string} addr
 * @returns {Promise<Object>}
 */
export async function getUniversalProfile(addr) {
  /* Call your internal Next.js API route */
  const response = await fetch('/api/universal-profile/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ addr }),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch profile through proxy')
  }

  /* The response now comes from your own domain, so no CORS error! */
  const result = await response.json()
  return result.data
}

export async function ensureProfile(address) {
  const res = await fetch(`/api/v1/users/profile/${address.toLowerCase()}`, {
    method: 'POST',
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error('Failed to ensure profile')
  }

  return res.json()
}
export const getPosts = async (page = 1, limit = 20, networkId = null, walletAddress = null, viewerAddress = null) => {
  /* Construct the URL with query parameters */
  let url = `/api/v1/networks/posts?page=${page}&limit=${limit}`

  if (networkId) {
    url += `&network_id=${networkId}`
  }

  if (walletAddress) {
    url += `&wallet_address=${walletAddress}`
  }

  if (viewerAddress) {
    url += `&viewer_address=${viewerAddress}`
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch posts')

  return response.json()
}

export const getPostById = async (networkId, postId, viewerAddress = null) => {
  // Determine the base URL based on the environment
  const isServer = typeof window === 'undefined'
  const baseUrl = isServer ? process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000' : ''

  const path = viewerAddress
    ? `/api/v1/networks/${networkId}/${postId}?viewer_address=${viewerAddress}`
    : `/api/v1/networks/${networkId}/${postId}`

  const url = `${baseUrl}${path}`

  const response = await fetch(url, { next: { revalidate: 30 } })
  if (!response.ok) throw new Error('Post fetch failed')
  const data = await response.json()
  return data
}
export const recordProfileView = async (address, walletAddress = null) => {
  try {
    const viewerId = getViewerId(walletAddress)
    const url = `/api/v1/users/${address.toLowerCase()}/view`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ viewer_id: viewerId }),
    })

    return await response.json()
  } catch (error) {
    console.error('Profile view tracking failed:', error)
  }
}

export const recordPostView = async (networkId, postId, walletAddress = null) => {
  try {
    /* Resolve the identity (Wallet or Guest UUID) */
    const viewerId = getViewerId(walletAddress)

    /* Construct the dynamic URL using the database primary key */
    const url = `/api/v1/networks/${networkId}/${postId}/view`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ viewer_id: viewerId }),
    })

    return await response.json()
  } catch (error) {
    /* Fail silently to avoid interrupting the user's reading experience */
    console.error('View tracking failed:', error)
  }
}

/**
 * Get local token
 * @returns string
 */
const getLocalToken = () => {
  if (localStorage.getItem('token') === null) return
  return localStorage.getItem('token').slice(1, localStorage.getItem('token').length - 1)
}

/**
 * Sends updated profile details to the server backend.
 * @param {FormData} formData - The multi-part form data payload containing profile fields.
 * @param {string} address - The wallet address identifying the account to update.
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export const updateProfile = async (formData, address) => {
  try {
    // Hits the Next.js API route you just created
    const response = await fetch(`/api/v1/users/profile/${address}`, {
      method: 'PUT',
      body: formData, // Passes the FormData object directly; content headers are set automatically
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to update profile' }
    }

    return { success: true, message: data.message }
  } catch (error) {
    console.error('API Client Error:', error)
    return { success: false, error: 'Network communication error' }
  }
}

export async function getViewPost(chainId, postId) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const params = new URLSearchParams({ chain_id: chainId, post_id: postId }).toString()
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}view/get?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function addViewPost(chainId, postId) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const params = new URLSearchParams({ chain_id: chainId, post_id: postId }).toString()
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}view/add?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return await response.json()
}

export async function getClaim() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}claim`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}
export async function getChillwhale() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}chillwhale`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}
export async function getCooking() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}cooking`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getAllProduct() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}allProduct`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getCategory() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}category`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getProduct() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}product`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Product List
 * @param {Array} filter
 * @returns
 */
export async function getProductList(filter) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const params = new URLSearchParams(filter).toString()
  console.log(params)
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}productList?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Product Detail
 * @returns
 */
export async function getProductDetail(id) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}productDetail/${id}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Comment
 * @returns
 */
export async function getComment(id) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}comment/get/${id}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function newComment(post, id) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}comment/new/${id}`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function invoiceUpdate(post, id) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}invoiceUpdate/${id}`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function paymentSMS(id) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify([]),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}paymentSMS/${id}`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function getPages() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}pages`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getBanner() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}banner`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Sign In
 * @param {json} post
 * @returns
 */
export async function signIn(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}signIn`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Sign Up
 * @param {json} post
 * @returns
 */
export async function signUp(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}signUp`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function forgotPassword(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}forgotPassword`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getIsValidToken() {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}isValidToken`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function getDashboard() {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}dashboard`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function getTicket() {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'GET',
    headers: myHeaders,
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}ticket/get`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function newTicket(post) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}ticket/new`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function updateTicket(data, id) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify(data),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}ticket/update/${id}`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function getInvoice() {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'GET',
    headers: myHeaders,
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}invoice`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

//================================================

/**
 * New record
 * @param {json} post
 * @returns
 */
export async function newRecord(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${import.meta.env.VITE_API_URL}newRecord`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * u
 * @returns
 */
export async function serverDate() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${import.meta.env.VITE_API_URL}serverDate/`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getTournamentList(filter = '') {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ filter: filter }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}tournamentList?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Dashboard
 * @returns
 */
export async function getLeaderboard(tournamentId) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const response = await fetch(`${import.meta.env.VITE_API_URL}leaderboard/${tournamentId}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getPlayer(tournamentId, walletAddr) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const response = await fetch(`${import.meta.env.VITE_API_URL}player/${tournamentId}/${walletAddr}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Event
 * @returns
 */
export async function getEvent(wallet_addr) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}event/get?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Event chart
 * @returns
 */
export async function getEventChart(wallet_addr) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}event/chart?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * View
 * @returns
 */
export async function addEvent(username, event, name) {
  let requestOptions = {
    method: 'POST',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ username: username, event: event, name: name }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}event/add?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * View chart
 * @returns
 */
export async function getViewChart(wallet_addr) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}view/chart?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * View chart
 * @returns
 */
export async function getConfig(username, addr = '') {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ username: username, wallet_addr: addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}config/get?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Link
 * @param {json} post
 * @returns
 */
export async function addUp(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${import.meta.env.VITE_API_URL}up/add`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Check username
 * @param {*} post
 * @param {*} wallet_addr
 * @returns
 */
export async function checkUser(post, wallet_addr) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}user/check?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Update username
 * @param {*} post
 * @param {*} wallet_addr
 * @returns
 */
export async function updateUser(post, wallet_addr) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}user/update?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Update username
 * @param {*} post
 * @param {*} wallet_addr
 * @returns
 */
export async function updateTelegramId(post, wallet_addr) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}user/telegram?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}
