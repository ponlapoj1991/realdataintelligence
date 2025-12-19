import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import type { Project } from '../types';
import { GlobalSettings } from '../types';
import { ChartTheme } from '../constants/chartTheme';

interface BuildReportsProps {
  project: Project;
  globalSettings?: GlobalSettings;
  chartTheme?: Pick<ChartTheme, 'id' | 'name' | 'palette' | 'typography'>;
  onMessage?: (event: MessageEvent) => void;
  onIframeLoad?: (iframe: HTMLIFrameElement | null) => void;
}

const BUILD_REPORTS_ENTRY = '/build-reports/index.html';

const BuildReports: React.FC<BuildReportsProps> = ({ project, globalSettings, chartTheme, onMessage, onIframeLoad }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [handshakeMessage, setHandshakeMessage] = useState<string>('Waiting for editor to respond...');

  useEffect(() => {
    return () => {
      onIframeLoad?.(null);
    };
  }, [onIframeLoad]);

  useEffect(() => {
    let aborted = false;
    const controller = new AbortController();

    fetch(BUILD_REPORTS_ENTRY, { method: 'HEAD', signal: controller.signal })
      .then((res) => {
        if (aborted) return;
        setIsAvailable(res.ok);
      })
      .catch(() => {
        if (aborted) return;
        setIsAvailable(false);
      });

    return () => {
      aborted = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'object' || !event.data) return;
      if (event.data?.source !== 'pptist' && event.data?.source !== 'realpptx') return;
      if (event.data?.type === 'ready') {
        setHandshakeMessage('Connected. RealPPTX editor ready.');
      }
      onMessage?.(event);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onMessage]);

  useEffect(() => {
    if (!isLoaded) return;
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;

    const payload = {
      source: 'realdata-host',
      type: 'project-context',
      project: {
        id: project.id,
        name: project.name,
        description: project.description ?? '',
      },
      globalSettings,
      chartTheme,
    };

    iframe.contentWindow.postMessage(payload, '*');
  }, [isLoaded, project, globalSettings, chartTheme]);

  const statusMessage = useMemo(() => {
    if (isAvailable === false) {
      return 'Editor assets are unavailable.';
    }
    if (isLoaded) return handshakeMessage;
    if (isAvailable) return 'Loading RealPPTX editor...';
    return 'Checking editor assets...';
  }, [handshakeMessage, isAvailable, isLoaded]);

  const handleReload = () => {
    setIsLoaded(false);
    setHandshakeMessage('Waiting for editor to respond...');
    iframeRef.current?.contentWindow?.location.reload();
  };

  useEffect(() => {
    if (!isLoaded) return;
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      {
        source: 'realdata-host',
        type: 'host-settings',
        payload: {
          globalSettings,
          chartTheme,
        },
      },
      '*'
    );
  }, [isLoaded, globalSettings, chartTheme]);

  return (
    <div
      className="w-full h-full relative flex flex-col"
      style={{ background: globalSettings?.theme?.background ?? '#0f1115' }}
    >
      {isAvailable === false && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 text-gray-200 space-y-4">
          <AlertTriangle className="w-12 h-12 text-amber-400" />
          <div>
            <p className="font-semibold text-lg mb-1">RealPPTX unavailable</p>
            <p className="text-sm text-gray-400">Editor bundle is not included in this environment.</p>
          </div>
        </div>
      )}

      {isAvailable !== false && (
        <div className="flex-1 relative">
          {!isLoaded && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center text-gray-300 space-y-3 z-10"
              style={{ background: globalSettings?.theme?.background ?? '#0f1115' }}
            >
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">{statusMessage}</span>
            </div>
          )}

          <iframe
            ref={iframeRef}
            title="Build Reports"
            src={BUILD_REPORTS_ENTRY}
            className="w-full h-full border-0 bg-white"
            onLoad={() => {
              setIsLoaded(true);
              onIframeLoad?.(iframeRef.current);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default BuildReports;
