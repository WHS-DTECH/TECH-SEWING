const form = document.getElementById('assessment-task-form');
const statusEl = document.getElementById('assessment-task-status');
const imageInputs = Array.from(document.querySelectorAll('.assessment-image-input'));
const uploadedImageUrls = new Array(5).fill(null);

function setStatus(message, isError) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b63a3a' : '#37618a';
}

function value(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function checked(id) {
  return !!document.getElementById(id)?.checked;
}

async function uploadImageFile(file) {
  const formData = new FormData();
  formData.append('image', file);

  const res = await fetch('/api/admin/upload-image', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Image upload failed');
  }

  return data.imageUrl;
}

imageInputs.forEach((input) => {
  input.addEventListener('change', async () => {
    const index = Number(input.dataset.index);
    const file = input.files && input.files[0];
    if (!file || !Number.isInteger(index) || index < 0 || index >= uploadedImageUrls.length) return;

    setStatus(`Uploading image ${index + 1}...`, false);

    try {
      const imageUrl = await uploadImageFile(file);
      uploadedImageUrls[index] = imageUrl;
      setStatus(`Image ${index + 1} uploaded.`, false);
    } catch (err) {
      setStatus(err.message || `Could not upload image ${index + 1}.`, true);
    }
  });
});

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = value('assessment-name');
    const yearLevel = value('assessment-year');
    const type = value('assessment-type');
    const category = value('assessment-category') || 'Assessment';
    const difficulty = value('assessment-difficulty');
    const subjectStream = value('assessment-subject-stream');
    const briefDescription = value('assessment-brief-description');
    const taskList = value('assessment-task-list');
    const standardDetails = value('assessment-standard-details');
    const achiever = value('assessment-achiever');
    const merit = value('assessment-merit');
    const excellence = value('assessment-excellence');
    const submissionRequirements = value('assessment-submission');
    const relevantImplications = value('assessment-implications');
    const progressLogging = value('assessment-progress');
    const feedback = value('assessment-feedback');
    const durationHours = Number(value('assessment-duration'));
    const allowedYears = new Set(['Year 9', 'Year 10', 'Year 11', 'Year 12']);
    const allowedTypes = new Set([
      'Hand Sewing',
      'Machine Sewing',
      'Embroidery',
      'Pattern Making',
      'Construction',
      'Finishing',
    ]);

    if (!name || !yearLevel || !type || !difficulty || !Number.isFinite(durationHours) || durationHours <= 0) {
      setStatus('Please complete the required fields before saving.', true);
      return;
    }

    if (!allowedYears.has(yearLevel)) {
      setStatus('Please choose a valid year level (Year 9 to Year 12).', true);
      return;
    }

    if (!allowedTypes.has(type)) {
      setStatus('Please choose a valid Sewing Room type.', true);
      return;
    }

    if (durationHours > 24) {
      setStatus('Duration must be 24 hours or less.', true);
      return;
    }

    setStatus('Saving assessment task...', false);

    const imageUrls = uploadedImageUrls.filter(Boolean);
    const outcomeImageUrl = imageUrls.length ? imageUrls[0] : null;

    const assessmentFocus = [
      achiever ? `Achiever:\n${achiever}` : '',
      merit ? `Merit:\n${merit}` : '',
      excellence ? `Excellence:\n${excellence}` : '',
      feedback ? `Feedback and Trialling:\n${feedback}` : '',
    ].filter(Boolean).join('\n\n');

    const descriptionParts = [
      briefDescription,
      subjectStream ? `Subject Stream: ${subjectStream}` : '',
      imageUrls.length > 1 ? `Supporting Images:\n${imageUrls.slice(1).join('\n')}` : '',
    ].filter(Boolean);

    const payload = {
      name,
      year_level: yearLevel,
      type,
      activity_category: category,
      duration_hours: durationHours,
      difficulty,
      description: descriptionParts.join('\n\n') || null,
      color: value('assessment-color') || 'color-lavender',
      is_this_week: checked('assessment-week'),
      outcome_image_url: outcomeImageUrl,
      idea_url: null,
      resources: standardDetails || null,
      equipment: submissionRequirements || null,
      instructions: taskList || null,
      class_management_notes: progressLogging || null,
      class_preparation: relevantImplications || null,
      assessment_focus: assessmentFocus || null,
    };

    try {
      const res = await fetch('/api/admin/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save assessment task');

      setStatus('Assessment task saved. Opening preview...', false);
      window.location.href = `/activity_detail.html?id=${data.id}`;
    } catch (err) {
      setStatus(err.message || 'Could not save assessment task', true);
    }
  });
}
