import { useState, useRef } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import { 
  Upload, 
  Sparkles, 
  Image as ImageIcon, 
  Trash2, 
  Download, 
  RefreshCw, 
  AlertTriangle,
  Info,
  Shirt,
  Settings,
  Lock,
  X,
  Sliders,
  ShieldCheck
} from 'lucide-react';

type Step = 'idle' | 'uploading' | 'analyzing' | 'generating' | 'completed';

const compressImage = (file: File, maxW = 1024, maxH = 1024): Promise<File> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxW) {
            height = Math.round((height * maxW) / width);
            width = maxW;
          }
        } else {
          if (height > maxH) {
            width = Math.round((width * maxH) / height);
            height = maxH;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          }, 'image/jpeg', 0.85);
        } else {
          resolve(file);
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};

export default function App() {
  // Image Upload States
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [modelPreview, setModelPreview] = useState<string | null>(null);
  const [clothFile, setClothFile] = useState<File | null>(null);
  const [clothPreview, setClothPreview] = useState<string | null>(null);

  // Configuration States
  const [aspectRatio, setAspectRatio] = useState<string>('3:4');
  const [customInstruction, setCustomInstruction] = useState<string>('');

  // Processing & Result States
  interface UsageDetails {
    geminiTokens: {
      promptTokens: number;
      candidatesTokens: number;
      totalTokens: number;
    } | null;
    modelUsed: string;
    imageGenerationCost: number;
    approxTotalCost: number;
  }
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationStep, setGenerationStep] = useState<Step>('idle');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [generationUsage, setGenerationUsage] = useState<UsageDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  // Admin Panel States
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState<string>('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(false);
  const [adminSettings, setAdminSettings] = useState<{
    maxGenerationsPerDay: number;
    generationsToday: number;
    lastResetDate: string;
    promptTemplate: string;
  } | null>(null);
  const [adminSaving, setAdminSaving] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  const handleAdminLogin = async () => {
    if (!adminPasswordInput) return;
    setAdminError(null);
    try {
      const apiBaseUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiBaseUrl}/api/admin/settings`, {
        headers: {
          'Authorization': `Bearer ${adminPasswordInput}`
        }
      });
      const data = await response.json();
      if (!response.ok) {
        setAdminError(data.error || 'Authentication failed.');
        return;
      }
      setAdminSettings(data);
      setIsAdminAuthenticated(true);
    } catch (err: any) {
      setAdminError('Failed to connect to admin server.');
    }
  };

  const handleSaveAdminSettings = async (resetCounter = false) => {
    if (!adminSettings) return;
    setAdminSaving(true);
    setAdminError(null);
    try {
      const apiBaseUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiBaseUrl}/api/admin/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminPasswordInput}`
        },
        body: JSON.stringify({
          maxGenerationsPerDay: adminSettings.maxGenerationsPerDay,
          promptTemplate: adminSettings.promptTemplate,
          resetCounter
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setAdminError(data.error || 'Failed to save settings.');
        setAdminSaving(false);
        return;
      }
      setAdminSettings(data.settings);
      setAdminSaving(false);
      alert('Settings saved successfully!');
    } catch (err: any) {
      setAdminError('Failed to save settings.');
      setAdminSaving(false);
    }
  };

  // Drag over states
  const [modelDragActive, setModelDragActive] = useState<boolean>(false);
  const [clothDragActive, setClothDragActive] = useState<boolean>(false);

  // Refs
  const modelInputRef = useRef<HTMLInputElement>(null);
  const clothInputRef = useRef<HTMLInputElement>(null);

  // Drag & Drop handlers
  const handleDrag = (e: DragEvent, type: 'model' | 'cloth') => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      if (type === 'model') setModelDragActive(true);
      if (type === 'cloth') setClothDragActive(true);
    } else if (e.type === 'dragleave') {
      if (type === 'model') setModelDragActive(false);
      if (type === 'cloth') setClothDragActive(false);
    }
  };

  const handleDrop = (e: DragEvent, type: 'model' | 'cloth') => {
    e.preventDefault();
    e.stopPropagation();
    if (type === 'model') setModelDragActive(false);
    if (type === 'cloth') setClothDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        handleFile(file, type);
      }
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>, type: 'model' | 'cloth') => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0], type);
    }
  };

  const handleFile = (file: File, type: 'model' | 'cloth') => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (type === 'model') {
        setModelFile(file);
        setModelPreview(reader.result as string);
      } else {
        setClothFile(file);
        setClothPreview(reader.result as string);
      }
    };
    reader.readAsDataURL(file);
    setError(null);
    setErrorDetails(null);
  };

  const removeFile = (type: 'model' | 'cloth') => {
    if (type === 'model') {
      setModelFile(null);
      setModelPreview(null);
      if (modelInputRef.current) modelInputRef.current.value = '';
    } else {
      setClothFile(null);
      setClothPreview(null);
      if (clothInputRef.current) clothInputRef.current.value = '';
    }
  };

  // Call generation API
  const handleGenerate = async () => {
    if (!modelFile || !clothFile) return;

    setIsGenerating(true);
    setGenerationStep('uploading');
    setGeneratedImage(null);
    setGeneratedPrompt(null);
    setError(null);
    setErrorDetails(null);

    let progressTimer1: any;
    let progressTimer2: any;

    try {
      // Compress both base images to optimize payload size
      console.log('Compressing images in-browser to optimize payload...');
      const compressedModel = await compressImage(modelFile);
      const compressedCloth = await compressImage(clothFile);
      console.log(`Model resized: ${(modelFile.size/1024).toFixed(1)}KB -> ${(compressedModel.size/1024).toFixed(1)}KB`);
      console.log(`Cloth resized: ${(clothFile.size/1024).toFixed(1)}KB -> ${(compressedCloth.size/1024).toFixed(1)}KB`);

      const formData = new FormData();
      formData.append('model', compressedModel);
      formData.append('cloth', compressedCloth);
      formData.append('aspectRatio', aspectRatio);
      formData.append('customInstruction', customInstruction);

      progressTimer1 = setTimeout(() => setGenerationStep('analyzing'), 2000);
      progressTimer2 = setTimeout(() => setGenerationStep('generating'), 5000);

      const apiBaseUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiBaseUrl}/api/try-on`, {
        method: 'POST',
        body: formData,
      });

      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to complete fashion try-on.');
        setErrorDetails(data.details || '');
        if (data.generatedPrompt) {
          setGeneratedPrompt(data.generatedPrompt);
        }
        setGenerationStep('idle');
        setIsGenerating(false);
        return;
      }

      setGeneratedImage(data.image);
      setGeneratedPrompt(data.generatedPrompt);
      setGenerationUsage(data.usage || null);
      setGenerationStep('completed');
    } catch (err: any) {
      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);
      console.error(err);
      setError('A network error occurred. Please verify your connection and ensure the backend server is running.');
      setErrorDetails(err.message || String(err));
      setGenerationStep('idle');
    } finally {
      setIsGenerating(false);
    }
  };

  const resetAll = () => {
    setModelFile(null);
    setModelPreview(null);
    setClothFile(null);
    setClothPreview(null);
    setGeneratedImage(null);
    setGeneratedPrompt(null);
    setGenerationUsage(null);
    setError(null);
    setErrorDetails(null);
    setGenerationStep('idle');
    setCustomInstruction('');
    if (modelInputRef.current) modelInputRef.current.value = '';
    if (clothInputRef.current) clothInputRef.current.value = '';
  };

  const triggerDownload = () => {
    if (!generatedImage) return;
    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `try-on-result-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header" style={{ position: 'relative' }}>
        <button 
          onClick={() => setIsAdminOpen(true)} 
          className="btn-admin" 
          style={{ position: 'absolute', top: '0rem', right: '0rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '0.6rem 0.9rem', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'var(--transition-smooth)', color: 'var(--color-text-main)' }}
        >
          <Settings size={15} />
          Admin Panel
        </button>
        <div className="brand-badge">
          <Sparkles size={14} />
          Reference Based Generation
        </div>
        <h1 className="app-title">Reference Based Generation</h1>
        <p className="app-subtitle">
          Upload a model photo and a garment photo. The AI will automatically detect the person's body shape, determine the fit, and replace their clothing while keeping the face and background identical.
        </p>
      </header>

      {/* Main Workspace */}
      <div className="workspace-grid">
        
        {/* Left Side: Upload & Configs */}
        <div className="panel-card">
          <h2 className="panel-title">
            <Shirt size={20} />
            Setup Workspace
          </h2>

          <div className="uploaders-container">
            
            {/* Model Upload */}
            <div 
              className={`dropzone ${modelDragActive ? 'active' : ''}`}
              onDragEnter={(e) => handleDrag(e, 'model')}
              onDragOver={(e) => handleDrag(e, 'model')}
              onDragLeave={(e) => handleDrag(e, 'model')}
              onDrop={(e) => handleDrop(e, 'model')}
              onClick={() => !modelPreview && modelInputRef.current?.click()}
              style={{ position: 'relative' }}
            >
              <input 
                type="file" 
                ref={modelInputRef} 
                onChange={(e) => handleFileChange(e, 'model')}
                accept="image/*"
                style={{ display: 'none' }}
              />
              
              {modelPreview ? (
                <div className="preview-container">
                  <img src={modelPreview} alt="Model Preview" className="preview-img" />
                  <button 
                    className="remove-btn" 
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile('model');
                    }}
                    title="Remove image"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="dropzone-icon">
                    <Upload size={24} />
                  </div>
                  <h3 className="dropzone-title">1. Model Image</h3>
                  <p className="dropzone-desc">Drag & drop or click to upload the person's photo</p>
                </>
              )}
            </div>

            {/* Cloth Upload */}
            <div 
              className={`dropzone ${clothDragActive ? 'active' : ''}`}
              onDragEnter={(e) => handleDrag(e, 'cloth')}
              onDragOver={(e) => handleDrag(e, 'cloth')}
              onDragLeave={(e) => handleDrag(e, 'cloth')}
              onDrop={(e) => handleDrop(e, 'cloth')}
              onClick={() => !clothPreview && clothInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={clothInputRef} 
                onChange={(e) => handleFileChange(e, 'cloth')}
                accept="image/*"
                style={{ display: 'none' }}
              />
              
              {clothPreview ? (
                <div className="preview-container">
                  <img src={clothPreview} alt="Garment Preview" className="preview-img" />
                  <button 
                    className="remove-btn" 
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile('cloth');
                    }}
                    title="Remove image"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="dropzone-icon">
                    <Upload size={24} />
                  </div>
                  <h3 className="dropzone-title">2. Clothing Image</h3>
                  <p className="dropzone-desc">Drag & drop or click to upload the garment photo</p>
                </>
              )}
            </div>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1rem', borderRadius: '12px', marginBottom: '1.5rem', border: '1px solid var(--border-glass)', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Info size={18} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-main)', margin: 0 }}>
              <strong>Automatic Body Detection</strong> is active. The AI will preserve the face, hair, and pose from your model image and swap only the clothing.
            </p>
          </div>

          {/* Config: Aspect Ratio */}
          <div className="config-group">
            <label className="config-label">Output Aspect Ratio</label>
            <div className="ratio-selector">
              {[
                { label: 'Portrait (3:4)', value: '3:4' },
                { label: 'Square (1:1)', value: '1:1' },
                { label: 'Landscape (4:3)', value: '4:3' }
              ].map((ratio) => (
                <button
                  key={ratio.value}
                  type="button"
                  className={`ratio-btn ${aspectRatio === ratio.value ? 'active' : ''}`}
                  onClick={() => setAspectRatio(ratio.value)}
                  disabled={isGenerating}
                >
                  {ratio.label}
                </button>
              ))}
            </div>
          </div>

          {/* Config: Custom Prompt instructions */}
          <div className="config-group">
            <label className="config-label">Style Instructions (Optional)</label>
            <textarea
              className="custom-input"
              placeholder="e.g. Fit the dress tightly, set in a sunny outdoor cafe, dramatic fashion lighting..."
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              disabled={isGenerating}
            />
          </div>

          {/* Action Trigger */}
          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={isGenerating || !modelFile || !clothFile}
          >
            {isGenerating ? (
              <>
                <RefreshCw size={20} className="spinner-ring" style={{ width: 20, height: 20, margin: 0, borderWidth: 2 }} />
                Generating Try-On...
              </>
            ) : (
              <>
                <Sparkles size={20} />
                Generate Try-On
              </>
            )}
          </button>
        </div>

        {/* Right Side: Results & Pipelines */}
        <div className="panel-card" style={{ minHeight: '450px' }}>
          
          {/* 1. Error Message */}
          {error && (
            <div className="error-box">
              <AlertTriangle className="error-icon" size={24} />
              <div style={{ flexGrow: 1 }}>
                <h3 className="error-title">Generation Error</h3>
                <p className="error-desc">{error}</p>
                {errorDetails && <pre className="error-details">{errorDetails}</pre>}
                
                {generatedPrompt && (
                  <div className="prompt-details" style={{ marginTop: '1rem' }}>
                    <div className="prompt-header">
                      <Info size={14} />
                      Prompt Details
                    </div>
                    <p className="prompt-content" style={{ fontSize: '0.8rem' }}>{generatedPrompt}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. Loading State */}
          {isGenerating && (
            <div className="loading-container">
              <div className="spinner-ring"></div>
              <h3 className="loading-title">Processing Fashion Try-On</h3>
              <p className="loading-desc">
                Analyzing garment and replacing clothing on your model while maintaining their exact facial details and pose.
              </p>
              
              <div className="pipeline-steps">
                <div className={`step-item ${generationStep === 'uploading' ? 'active' : 'completed'}`}>
                  <span className="step-indicator">1</span>
                  <span className="step-text">Uploading images to server</span>
                </div>
                <div className={`step-item ${
                  generationStep === 'uploading' ? 'pending' : 
                  generationStep === 'analyzing' ? 'active' : 'completed'
                }`}>
                  <span className="step-indicator">2</span>
                  <span className="step-text">Gemini parsing garment and fit characteristics</span>
                </div>
                <div className={`step-item ${
                  generationStep === 'generating' ? 'active' :
                  generationStep === 'completed' ? 'completed' : 'pending'
                }`}>
                  <span className="step-indicator">3</span>
                  <span className="step-text">Vertex AI Virtual Try-On Model</span>
                </div>
              </div>
            </div>
          )}

          {/* 3. Completed State */}
          {generationStep === 'completed' && generatedImage && (
            <div className="result-card">
              <h2 className="panel-title" style={{ marginBottom: '0.5rem' }}>
                <Sparkles size={20} />
                Try-On Result
              </h2>
              
              <div className="result-image-wrapper">
                <div className="result-badge">AI Generated</div>
                <img 
                  src={generatedImage} 
                  alt="Virtual Try-On Result" 
                  className="result-image" 
                />
              </div>

              {generatedPrompt && (
                <div className="prompt-details">
                  <div className="prompt-header">
                    <Sparkles size={12} />
                    Synthesized prompt details
                  </div>
                  <p className="prompt-content">{generatedPrompt}</p>
                </div>
              )}

              {generationUsage && (
                <div className="prompt-details" style={{ marginTop: '1rem', background: 'rgba(139, 92, 246, 0.05)', borderColor: 'rgba(139, 92, 246, 0.2)' }}>
                  <div className="prompt-header" style={{ color: 'var(--color-primary)' }}>
                    <Sparkles size={12} />
                    Usage & Estimated Cost
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    <div>
                      <strong style={{ color: 'var(--color-text-main)' }}>Model:</strong>{' '}
                      <span style={{ color: 'var(--color-text-muted)' }}>{generationUsage.modelUsed}</span>
                    </div>
                    <div>
                      <strong style={{ color: 'var(--color-text-main)' }}>Generation Cost:</strong>{' '}
                      <span style={{ color: 'var(--color-success)' }}>${generationUsage.imageGenerationCost.toFixed(2)} USD</span>
                    </div>
                    {generationUsage.geminiTokens && (
                      <div style={{ gridColumn: 'span 2', borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                        <div style={{ marginBottom: '0.25rem' }}>
                          <strong style={{ color: 'var(--color-text-main)' }}>Gemini 2.5 Flash Tokens:</strong>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                          <span>Input: {generationUsage.geminiTokens.promptTokens}</span>
                          <span>Output: {generationUsage.geminiTokens.candidatesTokens}</span>
                          <span>Total: {generationUsage.geminiTokens.totalTokens}</span>
                        </div>
                      </div>
                    )}
                    <div style={{ gridColumn: 'span 2', borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '0.5rem', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ color: 'var(--color-text-main)' }}>Estimated Total Cost:</strong>
                      <span style={{ color: 'var(--color-success)', fontWeight: 'bold', fontSize: '1rem' }}>
                        ${generationUsage.approxTotalCost.toFixed(5)} USD
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="action-buttons">
                <button className="btn-secondary" onClick={resetAll}>
                  <RefreshCw size={18} />
                  Try Another
                </button>
                <button className="btn-download" onClick={triggerDownload}>
                  <Download size={18} />
                  Download
                </button>
              </div>
            </div>
          )}

          {/* 4. Empty / Initial State */}
          {generationStep === 'idle' && !generatedImage && (
            <div className="empty-result-placeholder">
              <ImageIcon className="placeholder-icon" size={64} />
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem' }}>Result Preview</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: '300px' }}>
                Once you select both images and click "Generate Try-On", the AI-synthesized model photo will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
      {/* Admin Panel Modal */}
      {isAdminOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem' }}>
          <div className="panel-card" style={{ maxWidth: '500px', width: '100%', padding: '2rem', border: '1px solid var(--border-active)', boxShadow: '0 20px 50px rgba(139, 92, 246, 0.15)', position: 'relative' }}>
            <button 
              onClick={() => {
                setIsAdminOpen(false);
                setIsAdminAuthenticated(false);
                setAdminPasswordInput('');
                setAdminError(null);
              }} 
              style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            {!isAdminAuthenticated ? (
              // Login view
              <div style={{ display: 'flex', gap: '1.25rem', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--color-primary)' }}>
                  <Lock size={24} />
                  <h3 style={{ margin: 0, fontSize: '1.3rem' }}>Admin Authentication</h3>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
                  Please enter the administrator passcode to access rate limits and configuration settings.
                </p>
                <input 
                  type="password" 
                  className="custom-input" 
                  placeholder="Enter passcode" 
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                  style={{ minHeight: 'unset', padding: '0.75rem 1rem' }}
                />
                {adminError && <span style={{ color: 'var(--color-error)', fontSize: '0.8rem' }}>{adminError}</span>}
                <button className="generate-btn" onClick={handleAdminLogin} style={{ padding: '0.85rem' }}>
                  Unlock Settings
                </button>
              </div>
            ) : (
              // Authenticated Admin Dashboard view
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--color-success)' }}>
                  <ShieldCheck size={24} />
                  <h3 style={{ margin: 0, fontSize: '1.3rem' }}>Admin Dashboard</h3>
                </div>

                {adminSettings && (
                  <>
                    {/* Quota Counter Info */}
                    <div style={{ background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>Generations Today:</span>
                        <strong style={{ color: 'var(--color-text-main)' }}>{adminSettings.generationsToday} / {adminSettings.maxGenerationsPerDay}</strong>
                      </div>
                      <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, (adminSettings.generationsToday / adminSettings.maxGenerationsPerDay) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, var(--color-primary), var(--color-success))' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Last reset date: {adminSettings.lastResetDate || 'None'}</span>
                        <button 
                          onClick={() => handleSaveAdminSettings(true)} 
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-primary)', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          Reset Counter
                        </button>
                      </div>
                    </div>

                    {/* Setting: Max Generations Limit */}
                    <div className="config-group" style={{ marginBottom: 0 }}>
                      <label className="config-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Sliders size={14} />
                        Daily Generation Limit
                      </label>
                      <input 
                        type="number" 
                        className="custom-input" 
                        value={adminSettings.maxGenerationsPerDay} 
                        onChange={(e) => setAdminSettings({ ...adminSettings, maxGenerationsPerDay: Math.max(0, Number(e.target.value)) })}
                        style={{ minHeight: 'unset', padding: '0.75rem' }}
                      />
                    </div>

                    {/* Setting: Prompt Template */}
                    <div className="config-group" style={{ marginBottom: 0 }}>
                      <label className="config-label">Fallback Prompt Template</label>
                      <textarea 
                        className="custom-input" 
                        value={adminSettings.promptTemplate} 
                        onChange={(e) => setAdminSettings({ ...adminSettings, promptTemplate: e.target.value })}
                        style={{ minHeight: '120px', fontSize: '0.8rem' }}
                      />
                      <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', display: 'block' }}>
                        Use `{"{{garmentDescription}}"}` as a placeholder for Gemini's clothing parsing.
                      </span>
                    </div>

                    {adminError && <span style={{ color: 'var(--color-error)', fontSize: '0.8rem' }}>{adminError}</span>}

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                      <button 
                        className="btn-secondary" 
                        onClick={() => {
                          setIsAdminOpen(false);
                          setIsAdminAuthenticated(false);
                          setAdminPasswordInput('');
                          setAdminError(null);
                        }} 
                        style={{ flex: 1, padding: '0.85rem' }}
                      >
                        Cancel
                      </button>
                      <button 
                        className="btn-download" 
                        onClick={() => handleSaveAdminSettings(false)} 
                        disabled={adminSaving}
                        style={{ flex: 1, padding: '0.85rem' }}
                      >
                        {adminSaving ? 'Saving...' : 'Save Settings'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
