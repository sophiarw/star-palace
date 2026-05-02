import axios from 'axios'
import { useCallback } from 'react'

export async function postData(url: string, body: unknown) {
  return axios.post(url, body)
}

export function useSubmit(url: string) {
  return useCallback(async (data: unknown) => postData(url, data), [url])
}
