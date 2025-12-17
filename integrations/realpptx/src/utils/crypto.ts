import CryptoJS from 'crypto-js'

const REALPPTX_CRYPTO_KEY = 'realpptx'
const LEGACY_CRYPTO_KEY = 'pptist'

/**
 * 加密
 * @param msg 待加密字符串
 */
export const encrypt = (msg: string) => {
  return CryptoJS.AES.encrypt(msg, REALPPTX_CRYPTO_KEY).toString()
}

/**
 * 解密
 * @param ciphertext 待解密字符串
 */
export const decrypt = (ciphertext: string) => {
  const tryDecrypt = (key: string) => {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key)
    return bytes.toString(CryptoJS.enc.Utf8)
  }

  const realpptx = tryDecrypt(REALPPTX_CRYPTO_KEY)
  if (realpptx) return realpptx

  return tryDecrypt(LEGACY_CRYPTO_KEY)
}
