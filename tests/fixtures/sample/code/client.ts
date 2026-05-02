import axios from 'axios'
import { useState } from 'react'
import type { AxiosResponse } from 'axios'

export async function fetchData(url: string): Promise<AxiosResponse> {
  return axios.get(url)
}

export function useData(url: string) {
  const [data, setData] = useState(null)
  return { data, setData, url }
}
