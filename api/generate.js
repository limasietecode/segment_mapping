export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageBase64, userPrompt, style, controlMode = 'canny' } = req.body;

    if (!imageBase64 || !userPrompt) {
      return res.status(400).json({ error: 'Missing image or prompt' });
    }

    const stylePrompt = style && style !== 'none' ? ` Style: ${style}.` : '';
    const systemPrompt = `Photorealistic architectural exterior visualization. Preserve the overall massing, silhouette, opening placement, and main facade proportions from the control image. Single-building composition. High-quality daylight rendering, realistic materials, coherent shadows, architectural photography feel. User request: ${userPrompt}.${stylePrompt}`;

    const falApiKey = process.env.FAL_KEY;
    if (!falApiKey) {
      console.error("FAL_KEY is not set.");
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Using fal-ai/flux-general logic
    const payload = {
      prompt: systemPrompt,
      image_size: "landscape_4_3",
      num_images: 1,
      // Use easycontrols if fal-ai/flux-general supports it natively, otherwise fallback to standard controlnets structure
      controlnets: [
        {
          path: imageBase64,
          preprocessor: controlMode === 'seg' ? null : controlMode,
          conditioning_scale: 1.0
        }
      ]
    };

    const response = await fetch("https://fal.run/fal-ai/flux-general", {
      method: "POST",
      headers: {
        "Authorization": `Key ${falApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Fal API Error:", errorText);
      return res.status(response.status).json({ error: 'Failed to generate image', details: errorText });
    }

    const data = await response.json();
    
    // fal usually returns { images: [{ url: "...", content_type: "..." }], seed: 123 }
    if (data && data.images && data.images.length > 0) {
      return res.status(200).json({ imageUrl: data.images[0].url, seed: data.seed });
    } else {
      return res.status(500).json({ error: 'Unexpected response format from Fal.ai' });
    }

  } catch (error) {
    console.error("Proxy error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
