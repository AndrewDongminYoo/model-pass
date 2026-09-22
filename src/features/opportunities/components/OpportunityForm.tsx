import { useState, type FormEvent } from "react";
import { hairPromotionV1 } from "../../eligibility/templates/hair-promotion-v1";
import {
  makeupCertificationV1,
  makeupCertificationV1Metadata,
} from "../../eligibility/templates/makeup-certification-v1";
import {
  opportunityDraftSchema,
  type OpportunityCategory,
  type OpportunityDraft,
} from "../domain/opportunity";

interface OpportunityFormProps {
  onSubmit: (draft: OpportunityDraft) => void;
}

type BenefitType = "cash" | "procedure";

function rulesFor(category: OpportunityCategory) {
  const template =
    category === "hair_promotion" ? hairPromotionV1 : makeupCertificationV1;

  return template.map((rule) => ({ ...rule }));
}

export function OpportunityForm({ onSubmit }: OpportunityFormProps) {
  const [category, setCategory] =
    useState<OpportunityCategory>("hair_promotion");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [venueDistrict, setVenueDistrict] = useState("서울 강남구");
  const [expectedMinutes, setExpectedMinutes] = useState("60");
  const [benefitType, setBenefitType] = useState<BenefitType>("procedure");
  const [benefitDescription, setBenefitDescription] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const isMakeup = category === "makeup_certification";
    const result = opportunityDraftSchema.safeParse({
      category,
      title,
      startsAt,
      closesAt,
      venueDistrict,
      expectedMinutes,
      benefit:
        benefitType === "cash"
          ? {
              type: "cash",
              amount: cashAmount,
              description: benefitDescription,
            }
          : { type: "procedure", description: benefitDescription },
      rulesetId: isMakeup ? makeupCertificationV1Metadata.id : "hair-promotion",
      rulesetVersion: isMakeup ? makeupCertificationV1Metadata.version : 1,
      rules: rulesFor(category),
    });

    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".");
        if (!nextErrors[key]) nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    onSubmit(result.data);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div>
        <label htmlFor="category">Category</label>
        <select
          id="category"
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as OpportunityCategory)
          }
        >
          <option value="hair_promotion">Hair promotion exam</option>
          <option value="makeup_certification">
            Makeup certification exam
          </option>
        </select>
      </div>
      <div>
        <label htmlFor="procedure">Procedure</label>
        <input
          id="procedure"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {errors.title && <p role="alert">{errors.title}</p>}
      </div>
      <div>
        <label htmlFor="starts-at">Starts at</label>
        <input
          id="starts-at"
          type="datetime-local"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        {errors.startsAt && <p role="alert">{errors.startsAt}</p>}
      </div>
      <div>
        <label htmlFor="closes-at">Closes at</label>
        <input
          id="closes-at"
          type="datetime-local"
          value={closesAt}
          onChange={(event) => setClosesAt(event.target.value)}
        />
        {errors.closesAt && <p role="alert">{errors.closesAt}</p>}
      </div>
      <div>
        <label htmlFor="venue-district">Venue district</label>
        <input
          id="venue-district"
          value={venueDistrict}
          onChange={(event) => setVenueDistrict(event.target.value)}
        />
        {errors.venueDistrict && <p role="alert">{errors.venueDistrict}</p>}
      </div>
      <div>
        <label htmlFor="expected-minutes">Expected duration (minutes)</label>
        <input
          id="expected-minutes"
          type="number"
          min="1"
          value={expectedMinutes}
          onChange={(event) => setExpectedMinutes(event.target.value)}
        />
        {errors.expectedMinutes && <p role="alert">{errors.expectedMinutes}</p>}
      </div>
      <div>
        <label htmlFor="benefit-type">Benefit type</label>
        <select
          id="benefit-type"
          value={benefitType}
          onChange={(event) =>
            setBenefitType(event.target.value as BenefitType)
          }
        >
          <option value="procedure">Free or nearly free procedure</option>
          <option value="cash">Cash</option>
        </select>
      </div>
      <div>
        <label htmlFor="benefit-description">Benefit description</label>
        <input
          id="benefit-description"
          value={benefitDescription}
          onChange={(event) => setBenefitDescription(event.target.value)}
        />
        {errors["benefit.description"] && (
          <p role="alert">{errors["benefit.description"]}</p>
        )}
      </div>
      {benefitType === "cash" && (
        <div>
          <label htmlFor="cash-amount">Cash amount</label>
          <input
            id="cash-amount"
            type="number"
            min="1"
            value={cashAmount}
            onChange={(event) => setCashAmount(event.target.value)}
          />
          {errors["benefit.amount"] && (
            <p role="alert">{errors["benefit.amount"]}</p>
          )}
        </div>
      )}
      <button type="submit">Preview opportunity</button>
    </form>
  );
}
