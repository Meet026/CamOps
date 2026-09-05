import { useQuery } from '@tanstack/react-query'
import * as streamApi from '@/api/stream'

/** Every camera the video-stream relay can actually stream (real stream_path set). Short staleTime — unlike departments, which camera is registered can change while someone's on this page (a field officer adding one), and this list drives which tiles even show up as watchable. */
export function useStreamCameras() {
  return useQuery({
    queryKey: ['stream', 'cameras'],
    queryFn: () => streamApi.getStreamableCameras(),
    staleTime: 30_000,
  })
}
